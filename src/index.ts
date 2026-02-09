import { handleRegister } from "./routes/register";
import { handleToken } from "./routes/token";
import { handleValidate } from "./routes/validate";
import { handleHealth } from "./routes/health";
import { handleCapabilities } from "./routes/capabilities";

// Inline dashboard HTML
const dashboardHtml = `
<!DOCTYPE html>
<html>
  <head><title>Dashboard</title></head>
  <body>
    <h1>Agent Identity Dashboard</h1>
    <p>Dashboard loaded.</p>
  </body>
</html>
`;

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    // ⭐ ALWAYS produce a valid absolute URL
    // Wrangler sometimes sends relative URLs like "/dashboard"
    const url = new URL(
      request.url,
      request.url.startsWith("http") ? undefined : "http://localhost"
    );

    switch (url.pathname) {
      case "/api/register":
        return handleRegister(request, env);

      case "/api/token":
        return handleToken(request, env);

      case "/api/validate":
        return handleValidate(request, env);

      case "/health":
        return handleHealth(request, env);

      case "/capabilities":
        return handleCapabilities(request, env);

      // ⭐ Serve the dashboard
      case "/dashboard":
        return new Response(dashboardHtml, {
          headers: { "Content-Type": "text/html" },
        });

      // ⭐ Redirect /dashboard.html → /dashboard
      case "/dashboard.html":
        return Response.redirect(url.origin + "/dashboard", 302);

      // ⭐ Silence browser favicon requests
      case "/favicon.ico":
        return new Response("", { status: 204 });

      default:
        return new Response("Not found", { status: 404 });
    }
  },
};
