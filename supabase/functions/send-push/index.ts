// Supabase Edge Function: send-push
// Dispatches Mobile Push Notifications via Firebase Cloud Messaging (FCM v1) and Expo Push Service
// Handles Check-In, Check-Out, and Discount Approval notifications for Hotel City Park CRM

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
    console.log("[send-push] Incoming request payload:", JSON.stringify(payload));

    const title = payload.title || "🛎️ Hotel City Park";
    const body = payload.body || "New notification from Hotel Management System";
    const type = payload.type || "general";
    const data = payload.data || {};
    const tokens = Array.isArray(payload.tokens) ? payload.tokens : (payload.token ? [payload.token] : []);

    const results: any = {
      fcm: [],
      expo: null,
      timestamp: new Date().toISOString()
    };

    // 1. DISPATCH VIA FIREBASE CLOUD MESSAGING (FCM v1)
    try {
      const serviceAccount = getServiceAccount();
      const accessToken = await getGoogleAccessToken(serviceAccount);
      const projectId = serviceAccount.project_id;
      const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

      // Dispatch to relevant FCM Topic based on event type
      let topics: string[] = ["hotel_admin"];
      if (type === "store") {
        topics = ["hotel_admin"];
      } else if (type === "store_payment") {
        topics = ["store_bills"];
      } else {
        topics = ["hotel_admin"];
      }
      for (const topic of topics) {
        try {
          const fcmMessage = {
            message: {
              topic: topic,
              notification: {
                title: title,
                body: body,
              },
              data: {
                type: String(type),
                title: String(title),
                body: String(body),
                url: type === "discount" ? "/approvals" : (type === "checkin" ? (data.room_number ? `/room?id=${data.room_number}&room=${data.room_number}` : "/occupied") : (type === "store" ? "/(tabs)/store" : "/activity")),
                ...Object.fromEntries(
                  Object.entries(data).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v ?? "")])
                )
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

          const fcmRes = await fetch(fcmUrl, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(fcmMessage),
          });

          const fcmData = await fcmRes.json();
          results.fcm.push({ topic, success: fcmRes.ok, data: fcmData });
          console.log(`[send-push] FCM topic ${topic} status:`, fcmRes.status, fcmData);
        } catch (topicErr: any) {
          console.warn(`[send-push] FCM topic ${topic} error:`, topicErr.message);
        }
      }

      // If specific FCM device tokens were passed, dispatch directly to them
      const fcmTokens = tokens.filter((t: string) => t && !t.startsWith("ExponentPushToken") && !t.startsWith("ExpoPushToken"));
      for (const dToken of fcmTokens) {
        try {
          const directMessage = {
            message: {
              token: dToken,
              notification: { title, body },
              data: {
                type: String(type),
                title: String(title),
                body: String(body),
                url: type === "discount" ? "/approvals" : (type === "checkin" ? (data.room_number ? `/room?id=${data.room_number}&room=${data.room_number}` : "/occupied") : (type === "store" ? "/(tabs)/store" : "/activity")),
                ...Object.fromEntries(
                  Object.entries(data).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v ?? "")])
                )
              },
              android: {
                priority: "HIGH",
                notification: { channel_id: "high_importance_channel", sound: "default" }
              }
            }
          };
          const fcmRes = await fetch(fcmUrl, {
            method: "POST",
            headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(directMessage)
          });
          const fcmData = await fcmRes.json();
          results.fcm.push({ device: dToken.slice(0, 10) + "...", success: fcmRes.ok, data: fcmData });
        } catch (dErr: any) {
          console.warn("[send-push] Direct FCM error:", dErr.message);
        }
      }
    } catch (fcmErr: any) {
      console.error("[send-push] FCM Error:", fcmErr.message);
      results.fcm_error = fcmErr.message;
    }

    // 2. DISPATCH VIA EXPO PUSH SERVICE (if any Expo tokens passed)
    const expoTokens = tokens.filter((t: string) => t && (t.startsWith("ExponentPushToken") || t.startsWith("ExpoPushToken")));
    if (expoTokens.length > 0) {
      try {
        const expoMessages = expoTokens.map((to: string) => ({
          to,
          sound: "default",
          title,
          body,
          data: { ...data, type },
          channelId: "high_importance_channel",
          priority: "high"
        }));

        const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify(expoMessages)
        });
        results.expo = await expoRes.json();
        console.log("[send-push] Expo push dispatch status:", expoRes.status, results.expo);
      } catch (expoErr: any) {
        console.warn("[send-push] Expo push error:", expoErr.message);
        results.expo_error = expoErr.message;
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err: any) {
    console.error("[send-push] Top-level handler error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
