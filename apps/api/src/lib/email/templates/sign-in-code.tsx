import {
  Body,
  Container,
  Font,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import { email as c, fonts } from "@/lib/email/theme";

type Props = {
  code: string;
  /** Minutes the code stays valid, so the copy never drifts from the TTL. */
  expiresInMinutes: number;
};

/**
 * The sign-in code email.
 *
 * Deliberately plain: one heading, one code, one line of reassurance. Anything
 * more — buttons, illustrations, footers full of links — makes a transactional
 * message look like marketing, which is the fastest way into a spam folder and
 * the slowest way for someone to find six digits.
 */
export function SignInCodeEmail({ code, expiresInMinutes }: Props) {
  return (
    <Html lang="en">
      <Head>
        <Font
          fontFamily="Source Serif 4"
          fallbackFontFamily="Georgia"
          webFont={{
            url: "https://fonts.gstatic.com/s/sourceserif4/v13/vEFI2_tTDB4M7-auWDN0ahZJW1ge6NmXpVI.woff2",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
      </Head>
      {/* Shown in the inbox list next to the subject. */}
      <Preview>{`${code} is your BehindTheStory sign-in code`}</Preview>
      <Body
        style={{
          backgroundColor: c.background,
          color: c.foreground,
          fontFamily: fonts.sans,
          margin: 0,
          padding: "40px 16px",
        }}
      >
        <Container
          style={{
            backgroundColor: c.card,
            // Raised surfaces go lighter than the ground rather than casting a
            // shadow — the app's rule, and it renders identically everywhere.
            border: `1px solid ${c.border}`,
            borderRadius: 0,
            maxWidth: "480px",
            margin: "0 auto",
            padding: "40px",
          }}
        >
          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: c.mutedForeground,
              margin: "0 0 28px",
            }}
          >
            BehindTheStory
          </Text>

          <Heading
            as="h1"
            style={{
              fontFamily: fonts.serif,
              fontSize: "24px",
              lineHeight: 1.3,
              fontWeight: 400,
              color: c.foreground,
              margin: "0 0 12px",
            }}
          >
            Your sign-in code
          </Heading>

          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: "15px",
              lineHeight: 1.6,
              color: c.mutedForeground,
              margin: "0 0 28px",
            }}
          >
            Enter this code in the tab you started from. It expires in{" "}
            {expiresInMinutes} minutes and can only be used once.
          </Text>

          <Section
            style={{
              backgroundColor: c.secondary,
              border: `1px solid ${c.border}`,
              borderRadius: 0,
              padding: "20px",
              textAlign: "center" as const,
            }}
          >
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: "34px",
                // Wide tracking so the digits are read in pairs rather than as
                // one number, which is what makes a code easy to retype.
                letterSpacing: "0.3em",
                fontWeight: 600,
                color: c.primary,
                margin: 0,
                // The tracking adds a trailing gap; nudge it back to centre.
                textIndent: "0.3em",
              }}
            >
              {code}
            </Text>
          </Section>

          <Hr
            style={{
              border: "none",
              borderTop: `1px solid ${c.border}`,
              margin: "32px 0 20px",
            }}
          />

          <Text
            style={{
              fontFamily: fonts.sans,
              fontSize: "13px",
              lineHeight: 1.6,
              color: c.mutedForeground,
              margin: 0,
            }}
          >
            If you didn&apos;t ask to sign in, you can ignore this email — the
            code is useless without your inbox, and no one has been let in.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Sample data for `pnpm email:dev` and the static export. */
SignInCodeEmail.PreviewProps = {
  code: "402917",
  expiresInMinutes: 10,
} satisfies Props;

export default SignInCodeEmail;
