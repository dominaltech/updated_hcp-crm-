// Supabase Edge Function: send-store-push
// Dispatches FCM v1 notifications to Store Admin devices subscribed to topic 'store_bills'

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

function getServiceAccount() {
  const envVal = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (envVal) {
    try {
      return typeof envVal === "string" ? JSON.parse(envVal) : envVal;
    } catch (_) {}
  }
  return {
    type: "service_account",
    project_id: Deno.env.get("FIREBASE_PROJECT_ID") || "hotelcitypark-crm",
    client_email: Deno.env.get("FIREBASE_CLIENT_EMAIL") || "firebase-adminsdk-fbsvc@hotelcitypark-crm.iam.gserviceaccount.com",
    private_key: (Deno.env.get("FIREBASE_PRIVATE_KEY") || "").replace(/\\n/g, "\n"),
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getGoogleAccessToken(serviceAccount: any): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: serviceAccount.token_uri,
    exp: exp,
    iat: iat,
  };
  
  const base64UrlEncode = (obj: any) => {
    const str = JSON.stringify(obj);
    const base64 = btoa(unescape(encodeURIComponent(str)));
    return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  };
  
  const tokenInput = `${base64UrlEncode(header)}.${base64UrlEncode(claim)}`;
  
  const pem = serviceAccount.private_key || "";
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  if (!pem || !pem.includes(pemHeader)) {
    throw new Error("FIREBASE_PRIVATE_KEY or FIREBASE_SERVICE_ACCOUNT is not configured");
  }
  const pemContents = pem.substring(pem.indexOf(pemHeader) + pemHeader.length, pem.indexOf(pemFooter));
  const cleanPem = pemContents.replace(/\s+/g, "");
  
  const binaryDer = Uint8Array.from(atob(cleanPem), (c) => c.charCodeAt(0));
  
  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(tokenInput)
  );
  
  const base64Sign = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
    
  const jwt = `${tokenInput}.${base64Sign}`;
  
  const res = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google OAuth failure: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log("Store push payload:", payload);

    const serviceAccount = getServiceAccount();
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const projectId = serviceAccount.project_id;

    const rec = payload.record || payload;
    const vendorName = payload.vendor_name || rec.vendor_name || 'Vendor';
    const rawAmt = payload.amount || rec.total_amount || rec.amount || '0';
    const numAmt = parseFloat(String(rawAmt).replace(/,/g, '')) || 0;
    const amount = numAmt > 0 ? numAmt.toLocaleString('en-IN') : String(rawAmt);
    const billNumber = payload.bill_number ? ('Bill #' + payload.bill_number) : (rec.bill_number ? ('Bill #' + rec.bill_number) : 'New Bill');
    const paymentMode = payload.payment_mode || (rec.notes?.match(/Mode:\s*([^|]+)/)?.[1]?.trim()) || 'Bank Transfer';
    const gstInfo = payload.has_gst !== undefined ? (payload.has_gst ? 'With GST' : 'Without GST') : (rec.notes?.includes('With GST') ? 'With GST' : 'Without GST');
    const billId = payload.bill_id ? String(payload.bill_id) : String(rec.id || '');

    // TARGET TOPIC:
    // New bill by Storeman -> target 'hotel_admin' (Admin APK rings)
    // Payment by Admin -> target 'store_bills' (Storeman APK rings)
    const isPayment = payload.type === 'store_payment' || Boolean(payload.title?.toLowerCase().includes('paid'));
    const targetTopic = payload.topic || (isPayment ? "store_bills" : "hotel_admin");

    const title = payload.title || `📦 New Store Bill: ${vendorName}`;
    const body = payload.body || `${billNumber} for ₹${amount} (${paymentMode} • ${gstInfo})`;

    const fcmMessage = {
      message: {
        topic: targetTopic,
        notification: {
          title: title,
          body: body,
        },
        data: {
          billId: billId,
          url: isPayment ? '/recent' : '/(tabs)/store',
          action: isPayment ? 'open_recent' : 'open_store',
          type: payload.type || (isPayment ? 'store_payment' : 'store_bill'),
          ...(payload.data || {})
        },
        android: {
          priority: "HIGH",
          notification: {
            channel_id: "high_importance_channel",
            sound: "default",
            default_vibrate_timings: true,
            notification_priority: "PRIORITY_MAX",
          }
        }
      }
    };

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
    const fcmRes = await fetch(fcmUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fcmMessage),
    });

    const fcmData = await fcmRes.json();
    if (!fcmRes.ok) {
      console.error("FCM Send error:", fcmData);
      return new Response(JSON.stringify({ error: fcmData }), {
        status: fcmRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log("FCM Message Sent successfully:", fcmData);
    return new Response(JSON.stringify({ success: true, messageId: fcmData.name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("send-store-push error:", err);
    return new Response(JSON.stringify({ error: (err as any).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
