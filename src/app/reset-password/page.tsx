import { resetPasswordAction } from "@/lib/auth-actions";
import { FormMessage, Message } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { Lock, Zap } from "lucide-react";

export default async function ResetPassword(props: {
  searchParams: Promise<Message>;
}) {
  const searchParams = await props.searchParams;

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
              <div className="mx-auto mb-4 w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Lock size={18} className="text-blue-600" />
              </div>
              <h1 className="text-xl font-bold mb-1 text-gray-900">
                Create new password
              </h1>
              <p className="text-sm text-gray-600">
                Enter and confirm your new password.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <Label htmlFor="password" className="text-sm mb-1.5 block text-gray-700">
                  New password
                </Label>
                <PasswordInput
                  id="password"
                  name="password"
                  placeholder="Enter new password"
                  required
                  minLength={6}
                  className="w-full"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Must be at least 6 characters.
                </p>
              </div>

              <div>
                <Label htmlFor="confirmPassword" className="text-sm mb-1.5 block text-gray-700">
                  Confirm password
                </Label>
                <PasswordInput
                  id="confirmPassword"
                  name="confirmPassword"
                  placeholder="Confirm new password"
                  required
                  minLength={6}
                  className="w-full"
                />
              </div>
            </div>

            <SubmitButton
              formAction={resetPasswordAction}
              pendingText="Resetting password..."
              className="w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
            >
              Reset Password
            </SubmitButton>

            <FormMessage message={searchParams} />
          </form>
        </div>

        <p className="text-center mt-4 text-sm">
          <Link href="/sign-in" className="text-gray-600 hover:text-gray-900">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
