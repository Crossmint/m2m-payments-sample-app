import type { Metadata } from "next";
import { FocusScreen } from "@/components/focus-screen";
import { TopUpScreen } from "@/components/top-up-screen";

export const metadata: Metadata = { title: "Add credits" };

/** The same phone screen as sign in. The component owns its heading. */
export default async function TopUpPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return (
    <FocusScreen>
      <TopUpScreen requestId={requestId} />
    </FocusScreen>
  );
}
