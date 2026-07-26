"use client";

// Create a new policy rule. Wraps PolicyForm so route-export
// constraints (Next.js app-router rejects named exports from
// page.tsx) don't force the form's full body into this file.

import { PolicyForm } from "@/components/policies/PolicyForm";

export default function NewPolicyPage() {
  return <PolicyForm mode="create" />;
}
