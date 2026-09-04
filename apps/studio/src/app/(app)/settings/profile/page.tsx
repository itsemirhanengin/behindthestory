import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { ProfileForm } from "@/components/profile/profile-form";

export const metadata: Metadata = {
  title: "Profile · BehindTheStory",
};

/**
 * The account's own page.
 *
 * Narrower than the shelf on purpose: it is a form, and a form read across a
 * 1200px column is a form whose labels have lost their fields.
 */
export default function ProfilePage() {
  return (
    <>
      <AppHeader title="Profile" />

      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <ProfileForm />
      </main>
    </>
  );
}
