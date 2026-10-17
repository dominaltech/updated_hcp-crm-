// Supabase Edge Function: send-push
// Dispatches Mobile Push Notifications via Firebase Cloud Messaging (FCM v1) and Expo Push Service
// Handles Check-In, Check-Out, Discount Approval, and Store Bill notifications for Hotel City Park CRM

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as decodeBase64, encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const EMBEDDED_FIREBASE_SA = {
  type: "service_account",
  project_id: "hotelcitypark-crm",
  private_key_id: "cb2c37b86c9bb37e94b000a726276159a1df0c57",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQCrN9KwdAZ1vBxP\no6k3sKal1hk49+VyJyiPOWgiujJGt/as0cK8fFriXGLXezbFWdNMX2wLsAk/sdpW\nJNjUyDqhgcGcOD6JKYyQLAYhBSQXQmAc7yubyGCZOy8rJKH0g9CTVTE8nffZJHSS\nF/roUdOwVDAwR14+S727nvKzucO+j6Bn/AkWvlHslKrwy4ZhpUdvrlci8UDRPplI\ntXfSOR9Vu/F784j6Tyi0ulToKiLmZyqRGEL/0e4L91SnadHio03tw5GbUczi7YI5\nTTcsuMWP32ZEj8UmAMSpO5mRGXGG66QVsbeqtS0vy21HAqOEXNiCNH9ZFm/ku8X4\nPmphT9ePAgMBAAECggEAIfzjWH63t5BfaFm7IiBxfFMLT7k59VaboQ7KwrYGe+5R\ny82Z5BOlcPDY+CBv524k2TDKAGnx9BBooJgQ6PBUXzIkTlAF7fFvA0GR9+UO3IUj\nEitSE0sMDe7nNp+/fIvcEBslunw7MoIfl86l0o9Hv+V+aV8JcMFVSRTM5et21XFX\nOh2CwRiPW1yRuGmonLMhErO0qS7pnDXzE4BBzlGB9FJRHr6RsmmVK8OdIsUYrlUL\n38dXBHojPhCzgS6iwxVQry5rhhPvekXzvqTiYQgWbU0lLgyBFrDxP0dlqD31OrG\npphQ/colMc2zIdz0kPdkQowdHFzPZpia8O2V9DyHHQKBgQDanWXt2LV7QhQPr2Rr\n0VcAv7CSGqZC/kswqBEdNWJxjqUaTTNm66Iu0H0WEuYAqMMwGNd70WCAzi0AFCRI\nCZajLZxYrazLp0Sdv6OkjCWsUNVWquZ195pYlSkrgWH6zxQc8Qqv/HO9xuK0yksH\ntitZk07MTMZO+Ecbo/GJb79SkwKBgQDIf3iVDnJ181d32GxjBUbGAcl1ZeO5zgo9\nQiHYCcyHi/22hqDgNJv2go1qUFFHkjtCHFVOX1Rv0zS6QOCciZ41ozHxXBZ08dTo\n+aPbI3qSnPYA4fPfyJS4zrgqbvJmYLxFy5nD7/Uf32RWskxqHEGqqKPD8Ss6MSQz\nmhPky00YlQKBgQCyKmLew6WsDX9SBSw/Xn2cg50Aha2InbxjrCU+e7p+N7XAyLgi\nodksdAftjHtcgC2LLkO3ij0u3Fj6Xm/vMblNxadM8kYIN4sJURypxvoRBFPJ7UAj\nVia5GN9TsH9Mq6WFrMB8Cq+9M7ChjNg3MbUErLQkdlGMHHW/Rg5cZvEy9wKBgQCp\nbK4kpvSqH1uGdmgAtPC9Wb03a0YoOKgGY9/dg0pGMFHQ76r6SvqQMHn3oK9OX4+b\nqf2cIIplhIBF85TaMqByitklL7/6SnCz/mAsSarGQcTPsiA2tnSWRnjxwpcrVAtE\nn2vsWtU0fb14VWqlMAN9hsv8Q8tXfTcuM8Ej0XfwkQKBgQCrcW24ZXDRnxdjPeF8\nkjsdAYlDtNoQ5drcMNCLSh47eX1EXbGNKmjhf3H0P9tijpqKy8+Q+LHKz9b8k0zu\nEBn4Tn5BHr22u5rjaoEQfjUZ+BonKNQaYPcMhKj1OhMK2HWXtsGbquWfwTYqLHQP\nmwScQaNSTv9zpscbE4rFJfYyyA==\n-----END PRIVATE KEY-----\n",
  client_email: "firebase-adminsdk-fbsvc@hotelcitypark-crm.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token",
};

function getServiceAccount() {
  const envVal = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (envVal) {
    try {
      const parsed = typeof envVal === "string" ? JSON.parse(envVal) : envVal;
      if (parsed && parsed.private_key && parsed.private_key.includes("BEGIN PRIVATE KEY")) return parsed;
    } catch (_) {}
  }
  const pk = Deno.env.get("FIREBASE_PRIVATE_KEY");
  if (pk && pk.includes("BEGIN PRIVATE KEY")) {
    return {
      type: "service_account",
      project_id: Deno.env.get("FIREBASE_PROJECT_ID") || "hotelcitypark-crm",
      client_email: Deno.env.get("FIREBASE_CLIENT_EMAIL") || "firebase-adminsdk-fbsvc@hotelcitypark-crm.iam.gserviceaccount.com",
      private_key: pk.replace(/\\n/g, "\n"),
      token_uri: "https://oauth2.googleapis.com/token",
    };
  }
  return EMBEDDED_FIREBASE_SA;
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
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
    const bytes = new TextEncoder().encode(str);
    return encodeBase64(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  };
  
  const tokenInput = `${base64UrlEncode(header)}.${base64UrlEncode(claim)}`;
  
  const pem = serviceAccount.private_key || "";
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  if (!pem || !pem.includes(pemHeader)) {
    throw new Error("FIREBASE_PRIVATE_KEY or FIREBASE_SERVICE_ACCOUNT is not configured");
  }
  const pemContents = pem.substring(pem.indexOf(pemHeader) + pemHeader.length, pem.indexOf(pemFooter));
  const cleanPem = pemContents.replace(/[^A-Za-z0-9+/=]/g, "");
  
  const binaryDer = decodeBase64(cleanPem);
  
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
  
  const base64Sign = encodeBase64(new Uint8Array(signature))
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
    const inputTokens = Array.isArray(payload.tokens) ? payload.tokens : (payload.token ? [payload.token] : []);
    const targetTokens = [...inputTokens];

    // Auto-fetch registered device tokens from Supabase 'owner_devices'
    // This guarantees the Admin APK phone rings even if tokens weren't passed in caller payload
    if (targetTokens.length === 0 || type === "store" || type === "discount" || type === "checkin" || type === "checkout") {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://hlwmsllmqfdxfmqulrat.supabase.co";
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsd21zbGxtcWZkeGZtcXVscmF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NDY5NDIsImV4cCI6MjA3NTQyMjk0Mn0.p1b2Yq9mZ0WXZG1z0B8Yy7v9o0T0_h0T1a2B3c4D5eF";
        const devRes = await fetch(`${supabaseUrl}/rest/v1/owner_devices?select=fcm_token`, {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        });
        if (devRes.ok) {
          const devList = await devRes.json();
          if (Array.isArray(devList)) {
            for (const d of devList) {
              if (d.fcm_token && !targetTokens.includes(d.fcm_token)) {
                targetTokens.push(d.fcm_token);
              }
            }
          }
        }
      } catch (devErr: any) {
        console.warn("[send-push] Auto-fetch owner_devices tokens note:", devErr.message);
      }
    }

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

      // 2. DISPATCH DIRECTLY TO EVERY REGISTERED DEVICE TOKEN (Owner Android phones)
      const fcmTokens = targetTokens.filter((t: string) => t && !t.startsWith("ExponentPushToken") && !t.startsWith("ExpoPushToken"));
      console.log(`[send-push] Dispatching directly to ${fcmTokens.length} device tokens`);
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

    // 3. DISPATCH VIA EXPO PUSH SERVICE (if any Expo tokens passed)
    const expoTokens = targetTokens.filter((t: string) => t && (t.startsWith("ExponentPushToken") || t.startsWith("ExpoPushToken")));
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
