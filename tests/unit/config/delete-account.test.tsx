// Plan account-deletion DEL1: 'Delete account' in the Preferences popover. A confirm step explains the 30-day window and
// that signing in again cancels it; confirming calls accountSelfDelete.deleteMyAccount, signs this browser out and goes
// to /signin. Hidden for the app owner and while appAdmin.me loads; a server refusal shows its message.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE_ACCOUNT_TEXT, DeleteAccountItem } from "@/components/config/prefs/delete-account";

const functionName = (ref: unknown) => String((ref as Record<symbol, unknown>)[Symbol.for("functionName")] ?? ref);
let me: { isOwner: boolean } | null | undefined;
const calls: string[] = [];
let failWith: unknown = null;
const signOut = vi.fn(async () => {});
const push = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: () => me,
  useMutation: (ref: unknown) => async () => {
    calls.push(functionName(ref));
    if (failWith !== null) throw failWith;
    return { deleteAfter: 0 };
  },
}));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  me = { isOwner: false };
  calls.length = 0;
  failWith = null;
  signOut.mockClear();
  push.mockClear();
});

describe("DeleteAccountItem", () => {
  it("asks first, explaining the 30 days and that signing in cancels; Keep my account backs out", () => {
    render(<DeleteAccountItem />);
    fireEvent.click(screen.getByRole("button", { name: DELETE_ACCOUNT_TEXT.item }));
    const group = screen.getByRole("group", { name: DELETE_ACCOUNT_TEXT.title });
    expect(group.textContent).toContain("30 days");
    expect(group.textContent).toContain("Sign in again within those 30 days and the deletion is cancelled");
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: DELETE_ACCOUNT_TEXT.cancel }));
    expect(screen.getByRole("button", { name: DELETE_ACCOUNT_TEXT.item })).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("confirming deletes the account, signs out and goes to /signin", async () => {
    render(<DeleteAccountItem />);
    fireEvent.click(screen.getByRole("button", { name: DELETE_ACCOUNT_TEXT.item }));
    fireEvent.click(screen.getByRole("button", { name: DELETE_ACCOUNT_TEXT.confirm }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/signin"));
    expect(calls).toEqual(["accountSelfDelete:deleteMyAccount"]);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusal and stays signed in", async () => {
    failWith = new ConvexError({ code: "OWNER_ACCOUNT_UNDELETABLE" });
    render(<DeleteAccountItem />);
    fireEvent.click(screen.getByRole("button", { name: DELETE_ACCOUNT_TEXT.item }));
    fireEvent.click(screen.getByRole("button", { name: DELETE_ACCOUNT_TEXT.confirm }));
    expect((await screen.findByRole("alert")).textContent).toContain("can't be deleted");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("is hidden for the app owner, while loading and when signed out", () => {
    for (const value of [{ isOwner: true }, undefined, null]) {
      me = value;
      const { container, unmount } = render(<DeleteAccountItem />);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });
});
