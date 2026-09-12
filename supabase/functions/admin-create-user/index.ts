import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("Authorization") || "";

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
      return json({ error: "configuration_missing" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const { data: profile, error: profileError } = await userClient.rpc("get_my_session_profile").single();

    if (profileError || !profile?.permissions_json?.some((permission: string) => ["profiles.create", "roles.permissions.manage"].includes(permission))) {
      return json({ error: "permission_denied" }, 403);
    }

    const body = await request.json();
    const email = `${body.email || ""}`.trim().toLowerCase();
    const password = `${body.password || ""}`;
    const fullName = `${body.fullName || ""}`.trim();
    const memberCode = `${body.memberCode || ""}`.trim() || null;
    const memberType = `${body.memberType || "VISITOR"}`.trim() || "VISITOR";
    const roleName = `${body.roleName || ""}`.trim() || null;
    const status = `${body.status || "active"}`;
    const administrativeRoles = ["SuperAdmin", "Administrateur", "Bibliothécaire", "Modérateur", "Comptable"];

    if (!email || !password || !fullName) {
      return json({ error: "missing_required_fields" }, 400);
    }

    if (roleName && administrativeRoles.includes(roleName) && profile.role_name !== "SuperAdmin") {
      return json({ error: "superadmin_required_for_admin_accounts" }, 403);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });

    if (createError) {
      return json({ error: createError.message }, 400);
    }

    let roleId = null;
    if (roleName) {
      const { data: role } = await adminClient
        .from("roles_permissions")
        .select("id")
        .eq("role_name", roleName)
        .maybeSingle();
      roleId = role?.id || null;
    }

    const { data: savedProfile, error: profileSaveError } = await adminClient
      .from("profiles")
      .upsert({
        id: createdUser.user.id,
        full_name: fullName,
        email,
        member_code: memberCode,
        member_type: memberType,
        role_id: roleId,
        status
      })
      .select("*")
      .single();

    if (profileSaveError) {
      return json({ error: profileSaveError.message }, 400);
    }

    return json({ profile: savedProfile });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "unknown_error" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
