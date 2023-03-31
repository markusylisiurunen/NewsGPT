import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_: NextApiRequest, res: NextApiResponse) {
  res.setHeader("WWW-authenticate", "Basic");
  res.status(401).end(`Authentication is required.`);
}
