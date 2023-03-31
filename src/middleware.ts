import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: "/",
};

export function middleware(req: NextRequest) {
  const auth = req.headers.get("Authorization");
  const url = req.nextUrl;
  if (auth) {
    const value = auth.split(" ")[1];
    const [user, password] = atob(value).split(":");
    if (user === process.env.AUTH_USERNAME && password === process.env.AUTH_PASSWORD) {
      return NextResponse.next();
    }
  }
  url.pathname = "/api/auth";
  return NextResponse.rewrite(url);
}
