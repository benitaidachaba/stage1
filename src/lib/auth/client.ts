"use client";

import { createAuthClient } from "@neondatabase/auth/next";

/** Neon Auth uses the same-origin /api/auth proxy and HTTP-only cookies. */
export const authClient = createAuthClient();
