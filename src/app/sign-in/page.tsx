import { signInAction } from "@/lib/auth-actions";
import { FormMessage, Message } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { Zap } from "lucide-react";

interface LoginProps {
  searchParams: Promise<Message>;
}

export default async function SignInPage({ searchParams }: LoginProps) {
  const message = await searchParams;

  if ("message" in message) {
    return (
      <div className="flex h-screen w-full flex-1 items-center justify-center p-4 sm:max-w-md bg-white">
        <FormMessage message={message} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <Zap size={17} className="text-white" />
          </div>
          <span className="text-lg font-bold text-gray-900">OUTREACH</span>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <form className="flex flex-col gap-5">
            <div className="text-center">
              <h1 className="text-xl font-bold mb-1 text-gray-900">Welcome back</h1>
              <p className="text-sm text-gray-600">
                Don&apos;t have an account?{" "}
                <Link href="/sign-up" className="text-blue-600 hover:underline">
                  Sign up free
                </Link>
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <Label htmlFor="email" className="text-sm mb-1.5 block text-gray-700">
                  Email
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  className="w-full"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <Label htmlFor="password" className="text-sm text-gray-700">
                    Password
                  </Label>
                  <Link href="/forgot-password" className="text-xs text-gray-500 hover:text-gray-700">
                    Forgot password?
                  </Link>
                </div>
                <PasswordInput
                  id="password"
                  name="password"
                  placeholder="••••••••"
                  required
                  className="w-full"
                />
              </div>
            </div>

            <SubmitButton
              className="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
              pendingText="Signing in..."
              formAction={signInAction}
            >
              Sign In
            </SubmitButton>

            <FormMessage message={message} />
          </form>
        </div>

        <p className="text-center mt-4 text-sm">
          <Link href="/" className="text-gray-600 hover:text-gray-900">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
