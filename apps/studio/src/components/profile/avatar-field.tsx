"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { RiImageAddLine, RiLoader4Line } from "@remixicon/react";

import { profileInitial } from "@behindthestory/core/profile";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AVATAR_ACCEPT,
  AvatarImageError,
  prepareAvatar,
} from "@/lib/avatar-image";
import { useRemoveAvatar, useUploadAvatar, type Profile } from "@/lib/queries/profile";

/**
 * The avatar, and the two things you can do to it.
 *
 * The picture is not part of the form below: it saves the moment it is chosen
 * rather than waiting for a Save button. Choosing a photo is already a
 * deliberate act with a confirmation step of its own — the file dialog — and
 * making it also survive a form submit is the kind of thing that loses
 * somebody's upload.
 */
export function AvatarField({ profile }: { profile: Profile }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const [preparing, setPreparing] = useState(false);

  const busy = preparing || upload.isPending || remove.isPending;

  async function choose(file: File | undefined) {
    if (!file) return;

    setPreparing(true);
    try {
      const prepared = await prepareAvatar(file);
      await upload.mutateAsync(prepared);
      toast.success("Avatar updated.");
    } catch (cause) {
      toast.error(
        cause instanceof AvatarImageError || cause instanceof Error
          ? cause.message
          : "That image could not be uploaded.",
      );
    } finally {
      setPreparing(false);
      // Cleared so picking the same file twice in a row still fires `change`.
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-5">
      <div className="relative">
        <Avatar className="size-20">
          {profile.avatarUrl ? (
            <AvatarImage
              src={profile.avatarUrl}
              alt=""
              // The object key changes with the bytes, so the browser may cache
              // this forever and still never show a stale face.
            />
          ) : null}
          <AvatarFallback className="bg-primary/10 font-heading text-2xl font-medium text-primary">
            {profileInitial(profile)}
          </AvatarFallback>
        </Avatar>

        {busy ? (
          <span className="absolute inset-0 flex items-center justify-center bg-background/70">
            <RiLoader4Line className="size-5 animate-spin text-primary" />
          </span>
        ) : null}
      </div>

      {/* No format or sizing note: the file picker is already filtered to what
          is accepted, and the failure cases have real error messages. Telling
          everyone about them up front only taxes the people who never hit one. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <RiImageAddLine className="size-4" />
          {profile.avatarUrl ? "Replace" : "Upload"}
        </Button>

        {profile.avatarUrl ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              remove.mutate(undefined, {
                onSuccess: () => toast.success("Avatar removed."),
                onError: (cause) => toast.error(cause.message),
              })
            }
          >
            Remove
          </Button>
        ) : null}
      </div>

      <input
        ref={input}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        onChange={(event) => void choose(event.target.files?.[0])}
      />
    </div>
  );
}
