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

import { email as c, fonts } from "#email/theme";

type Props = {
  code: string;
  /** Minutes the code stays valid, so the copy never drifts from the TTL. */
  expiresInMinutes: number;
};

/**
 * The email-change code, sent to the address being moved *to*.
 *
 * Same shape as the sign-in code on purpose — someone who has seen one should
 * recognise the other instantly — but the copy has a different job. A sign-in
 * code says "you asked for this"; this one has to make clear that the account
 * has not moved yet and that ignoring the mail is the safe thing to do, because
 * this is the message a person receives if someone typed their address by
 * mistake or on purpose.
 */
export function EmailChangeCodeEmail({ code, expiresInMinutes }: Props) {
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
      <Preview>{`${code} is your BehindTheStory email confirmation code`}</Preview>
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
            Confirm this address
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
            Someone asked to move a BehindTheStory account to this address.
            Enter this code in the tab you started from to finish the change. It
            expires in {expiresInMinutes} minutes and can only be used once.
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
                letterSpacing: "0.3em",
                fontWeight: 600,
                color: c.primary,
                margin: 0,
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
            If this wasn&apos;t you, ignore this email. Nothing has changed, and
            no account can reach this address without the code above.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Sample data for `pnpm email:dev` and the static export. */
EmailChangeCodeEmail.PreviewProps = {
  code: "518204",
  expiresInMinutes: 10,
} satisfies Props;

export default EmailChangeCodeEmail;
