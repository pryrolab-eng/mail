import { FormMessage, Message } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { signUpAction } from "@/lib/auth-actions";
import { UrlProvider } from "@/components/url-provider";
import { Zap } from "lucide-react";

export default async function Signup(props: {
  searchParams: Promise<Message>;
}) {
  const searchParams = await props.searchParams;
  if ("message" in searchParams) {
    return (
      <div className="flex h-screen w-full flex-1 items-center justify-center p-4 sm:max-w-md bg-white">
        <FormMessage message={searchParams} />
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
          <UrlProvider>
            <form className="flex flex-col gap-5">
              <div className="text-center">
                <h1 className="text-xl font-bold mb-1 text-gray-900">
                  Create your account
                </h1>
                <p className="text-sm text-gray-600">
                  Already have an account?{" "}
                  <Link href="/sign-in" className="text-blue-600 hover:underline">
                    Sign in
                  </Link>
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <Label htmlFor="full_name" className="text-sm mb-1.5 block text-gray-700">
                    Full Name
                  </Label>
                  <Input
                    id="full_name"
                    name="full_name"
                    type="text"
                    placeholder="John Doe"
                    required
                    className="w-full"
                  />
                </div>

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
                  <Label htmlFor="password" className="text-sm mb-1.5 block text-gray-700">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    name="password"
                    placeholder="••••••••"
                    minLength={6}
                    required
                    className="w-full"
                  />
                </div>
              </div>

              <SubmitButton
                formAction={signUpAction}
                pendingText="Creating account..."
                className="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
              >
                Get Started Free
              </SubmitButton>

              <FormMessage message={searchParams} />
            </form>
          </UrlProvider>
        </div>

        <p className="text-center mt-4 text-sm">
          <Link href="/" className="text-gray-600 hover:text-gray-900">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
