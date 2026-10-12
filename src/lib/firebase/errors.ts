import { FirebaseError } from "firebase/app";

export function accountError(cause: unknown) {
  const messages: Record<string, string> = {
    "auth/invalid-credential":
      "The email or password is incorrect. Please try again.",
    "auth/wrong-password":
      "The email or password is incorrect. Please try again.",
    "auth/user-not-found":
      "The email or password is incorrect. Please try again.",
    "auth/email-already-in-use":
      "Unable to create this account. Try signing in or resetting your password.",
    "auth/weak-password": "Choose a password with at least 8 characters.",
    "auth/too-many-requests":
      "Too many attempts. Wait a few minutes before trying again.",
    "auth/network-request-failed":
      "Connection failed. Check your connection and try again.",
    "auth/requires-recent-login":
      "Sign in again before changing your password.",
    "permission-denied":
      "You don’t have permission for this action. Check your email verification and team access.",
    unavailable: "The connection is unavailable. Please try again.",
  };
  if (cause instanceof FirebaseError)
    return (
      messages[cause.code] ||
      "Unable to complete this action. Please try again."
    );
  return cause instanceof Error
    ? cause.message
    : "Unable to complete this action. Please try again.";
}
