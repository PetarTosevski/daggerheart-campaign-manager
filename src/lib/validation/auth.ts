import { z } from "zod";

/**
 * Validates sign-in credentials at the server boundary. Client-side validation
 * is only for feedback and is never trusted.
 */
export const signInSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type SignInInput = z.infer<typeof signInSchema>;
