import { resetPasswordAction } from "@/app/actions";
import { FormMessage, Message } from "@/components/form-message";
import Navbar from "@/components/navbar";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";

export default async function ResetPassword(props: {
  searchParams: Promise<Message>;
}) {
  const searchParams = await props.searchParams;
  if ("message" in searchParams) {
    return (
      <div className="flex h-screen w-full flex-1 items-center justify-center p-4 sm:max-w-md">
        <FormMessage message={searchParams} />
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
          <form className="flex flex-col space-y-6">
            {/* Header */}
            <div className="space-y-3 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <Lock size={20} className="text-green-600" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Create New Password</h1>
              <p className="text-sm text-muted-foreground">
                Enter your new password below. Make sure it's strong and secure.
              </p>
            </div>

            {/* Password inputs */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-semibold" style={{ color: "#333" }}>
                  NEW PASSWORD
                </Label>
                <Input
                  id="password"
                  type="password"
                  name="password"
                  placeholder="Enter new password"
                  required
                  minLength={6}
                  className="w-full h-11"
                />
                <p className="text-xs text-muted-foreground">Must be at least 6 characters</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-semibold" style={{ color: "#333" }}>
                  CONFIRM PASSWORD
                </Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  name="confirmPassword"
                  placeholder="Confirm new password"
                  required
                  minLength={6}
                  className="w-full h-11"
                />
              </div>
            </div>

            {/* Submit button */}
            <SubmitButton
              formAction={resetPasswordAction}
              pendingText="Resetting password..."
              className="w-full h-11 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
            >
              Reset Password
            </SubmitButton>

            <FormMessage message={searchParams} />
          </form>
        </div>
      </div>
    </>
  );
}
