// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Virtual end-to-end tests for the booking GCash / PayMongo payment flow
 * (bookingPaymentService). Everything network- and database-facing is mocked,
 * so this exercises the client logic exactly as the browser would run it:
 *
 *   start checkout ──► redirect to PayMongo ──► poll status ──► verdict
 *
 * The security contract under test: the redirect/poll can only ever READ
 * state; "paid" arrives exclusively from the (mocked) webhook-committed row.
 */

// The supabase client is created from env vars at import time, so the whole
// module is replaced with a controllable double.
vi.mock("../lib/supabase", () => {
  const rpc = vi.fn();
  const getSession = vi.fn();
  return {
    isSupabaseConfigured: true,
    supabase: {
      rpc,
      auth: { getSession },
    },
    // Exposed so tests can reach the same mock instance.
    __mocks: { rpc, getSession },
  };
});

import {
  PAYMONGO_METHOD,
  bookingPaymentMessage,
  getBookingPaymentStatus,
  startBookingCheckout,
  waitForBookingPayment,
} from "./bookingPaymentService";
import { __mocks } from "../lib/supabase";

const BASE_URL = "https://project.supabase.co";

/** Install a fetch double and an env URL for startBookingCheckout. */
function mockFetch(handler) {
  vi.stubEnv("VITE_SUPABASE_URL", BASE_URL);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => handler(String(url), options)),
  );
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  __mocks.rpc.mockReset();
  __mocks.getSession.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------
 * startBookingCheckout — the only browser-side action that moves money
 * ---------------------------------------------------------------------- */
describe("startBookingCheckout", () => {
  it("posts the booking number (no price!) and returns the checkout URL", async () => {
    __mocks.getSession.mockResolvedValue({ data: { session: null } });
    mockFetch((url) => {
      expect(url).toBe(`${BASE_URL}/functions/v1/paymongo-checkout`);
      return {
        ok: true,
        json: async () => ({
          checkoutUrl: "https://paymongo.com/checkout/cs_123",
          checkoutSessionId: "cs_123",
          amount: 300,
        }),
      };
    });

    const result = await startBookingCheckout({ bookingNumber: "RB-1" });
    expect(result).toEqual({
      checkoutUrl: "https://paymongo.com/checkout/cs_123",
      sessionId: "cs_123",
      amount: 300,
    });
  });

  it("attaches the Bearer token for a signed-in owner", async () => {
    __mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "jwt-token" } },
    });
    let seenHeaders = null;
    mockFetch((_url, options) => {
      seenHeaders = options.headers;
      return { ok: true, json: async () => ({ checkoutUrl: "https://x" }) };
    });

    await startBookingCheckout({ bookingNumber: "RB-1" });
    expect(seenHeaders.Authorization).toBe("Bearer jwt-token");
  });

  it("sends the guest token in the body for unsigned players", async () => {
    __mocks.getSession.mockResolvedValue({ data: { session: null } });
    let seenBody = null;
    mockFetch((_url, options) => {
      seenBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ checkoutUrl: "https://x" }) };
    });

    await startBookingCheckout({ bookingNumber: "RB-1", guestToken: "tok-9" });
    expect(seenBody).toEqual({ bookingNumber: "RB-1", guestToken: "tok-9" });
  });

  it("surfaces the server's error message on failure", async () => {
    __mocks.getSession.mockResolvedValue({ data: { session: null } });
    mockFetch(() => ({
      ok: false,
      json: async () => ({ error: "This booking is already paid." }),
    }));

    await expect(
      startBookingCheckout({ bookingNumber: "RB-1" }),
    ).rejects.toThrow("This booking is already paid.");
  });

  it("falls back to a friendly error when the body is unreadable", async () => {
    __mocks.getSession.mockResolvedValue({ data: { session: null } });
    mockFetch(() => ({
      ok: false,
      json: async () => {
        throw new Error("x");
      },
    }));

    await expect(
      startBookingCheckout({ bookingNumber: "RB-1" }),
    ).rejects.toThrow("Could not start the GCash payment.");
  });

  it("rejects a session without a checkout URL", async () => {
    __mocks.getSession.mockResolvedValue({ data: { session: null } });
    mockFetch(() => ({ ok: true, json: async () => ({}) }));

    await expect(
      startBookingCheckout({ bookingNumber: "RB-1" }),
    ).rejects.toThrow("PayMongo did not return a checkout link.");
  });

  it("requires a booking reference", async () => {
    await expect(startBookingCheckout({})).rejects.toThrow(
      "A booking reference is required.",
    );
  });
});

/* -------------------------------------------------------------------------
 * getBookingPaymentStatus — the authoritative read
 * ---------------------------------------------------------------------- */
describe("getBookingPaymentStatus", () => {
  it("queries the RPC with the booking number and guest token", async () => {
    __mocks.rpc.mockResolvedValue({
      data: [
        {
          payment_status: "pending",
          booking_status: "upcoming",
          paymongo_reference: null,
          paid_at: null,
        },
      ],
      error: null,
    });

    const state = await getBookingPaymentStatus({
      bookingNumber: "RB-1",
      guestToken: "tok-9",
    });
    expect(__mocks.rpc).toHaveBeenCalledWith("get_booking_payment_status", {
      p_booking_number: "RB-1",
      p_token: "tok-9",
    });
    expect(state).toEqual({
      paymentStatus: "pending",
      bookingStatus: "upcoming",
      reference: null,
      paidAt: null,
    });
  });

  it("accepts a single-object (non-array) RPC payload", async () => {
    __mocks.rpc.mockResolvedValue({
      data: {
        payment_status: "paid",
        booking_status: "confirmed",
        paymongo_reference: "pay_1",
        paid_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    });

    const state = await getBookingPaymentStatus({ bookingNumber: "RB-1" });
    expect(state.paymentStatus).toBe("paid");
    expect(state.reference).toBe("pay_1");
  });

  it("throws the RPC error through", async () => {
    __mocks.rpc.mockResolvedValue({
      data: null,
      error: new Error("function not found"),
    });
    await expect(
      getBookingPaymentStatus({ bookingNumber: "RB-1" }),
    ).rejects.toThrow("function not found");
  });

  it("throws when the booking is not visible to this caller", async () => {
    // RLS/token mismatch: no row comes back.
    __mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(
      getBookingPaymentStatus({ bookingNumber: "RB-OTHER", guestToken: "bad" }),
    ).rejects.toThrow("Booking was not found.");
  });
});

/* -------------------------------------------------------------------------
 * waitForBookingPayment — the post-redirect poll loop
 * ---------------------------------------------------------------------- */
describe("waitForBookingPayment", () => {
  it("resolves paid:true as soon as the webhook lands", async () => {
    const statuses = [
      { payment_status: "pending", booking_status: "upcoming" },
      { payment_status: "paid", booking_status: "confirmed" },
    ];
    let call = 0;
    __mocks.rpc.mockImplementation(async () => ({
      data: [statuses[Math.min(call++, statuses.length - 1)]],
      error: null,
    }));
    const ticks = [];

    const { paid, state } = await waitForBookingPayment({
      bookingNumber: "RB-1",
      timeoutMs: 10000,
      intervalMs: 1,
      onTick: (s) => ticks.push(s.paymentStatus),
    });

    expect(paid).toBe(true);
    expect(state.paymentStatus).toBe("paid");
    // Polled at least twice: pending first, then the webhook's paid row.
    expect(ticks).toEqual(["pending", "paid"]);
  });

  it("returns paid:false on the timeout deadline without giving up early", async () => {
    __mocks.rpc.mockResolvedValue({
      data: [{ payment_status: "pending", booking_status: "upcoming" }],
      error: null,
    });

    const { paid, state } = await waitForBookingPayment({
      bookingNumber: "RB-1",
      // Generous deadline so a slow mock/clock never skips the second poll.
      timeoutMs: 80,
      intervalMs: 5,
    });
    expect(paid).toBe(false);
    expect(state.paymentStatus).toBe("pending");
    expect(__mocks.rpc.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 10000);

  it("stops immediately when the booking was cancelled", async () => {
    __mocks.rpc.mockResolvedValue({
      data: [{ payment_status: "pending", booking_status: "cancelled" }],
      error: null,
    });

    const { paid, state } = await waitForBookingPayment({
      bookingNumber: "RB-1",
      timeoutMs: 30000,
      intervalMs: 1,
    });
    expect(paid).toBe(false);
    expect(state.bookingStatus).toBe("cancelled");
    expect(__mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps polling through transient errors (offline, cold start)", async () => {
    let call = 0;
    __mocks.rpc.mockImplementation(async () => {
      call += 1;
      if (call < 3) return { data: null, error: new Error("network down") };
      return {
        data: [{ payment_status: "paid", booking_status: "confirmed" }],
        error: null,
      };
    });

    const { paid } = await waitForBookingPayment({
      bookingNumber: "RB-1",
      timeoutMs: 10000,
      intervalMs: 1,
    });
    expect(paid).toBe(true);
    expect(call).toBe(3);
  });

  it("always polls at least once even with a zero timeout", async () => {
    __mocks.rpc.mockResolvedValue({
      data: [{ payment_status: "pending", booking_status: "upcoming" }],
      error: null,
    });

    const { paid, state } = await waitForBookingPayment({
      bookingNumber: "RB-1",
      timeoutMs: 0,
      intervalMs: 1,
    });
    expect(__mocks.rpc).toHaveBeenCalledTimes(1);
    expect(paid).toBe(false);
    expect(state).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * bookingPaymentMessage — the copy the player sees
 * ---------------------------------------------------------------------- */
describe("bookingPaymentMessage", () => {
  it("maps each state to the right copy", () => {
    expect(bookingPaymentMessage(null)).toBe("");
    expect(
      bookingPaymentMessage({
        paymentStatus: "paid",
        bookingStatus: "confirmed",
      }),
    ).toMatch(/Payment received/);
    expect(
      bookingPaymentMessage({
        paymentStatus: "pending",
        bookingStatus: "cancelled",
      }),
    ).toMatch(/cancelled/);
    expect(
      bookingPaymentMessage({
        paymentStatus: "refunded",
        bookingStatus: "confirmed",
      }),
    ).toMatch(/refunded/);
    expect(
      bookingPaymentMessage({
        paymentStatus: "pending",
        bookingStatus: "upcoming",
      }),
    ).toMatch(/Waiting for PayMongo/);
  });

  it("labels the payment method GCash everywhere", () => {
    expect(PAYMONGO_METHOD).toBe("GCash");
  });
});

/* -------------------------------------------------------------------------
 * Full simulated journey: guest pays, webhook confirms, redirect polls
 * ---------------------------------------------------------------------- */
describe("virtual end-to-end: guest booking payment journey", () => {
  it("checkout → pending poll → paid, with no client-side confirmation", async () => {
    // 1) Guest starts the checkout; the Edge Function returns the hosted URL.
    __mocks.getSession.mockResolvedValue({ data: { session: null } });
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        checkoutUrl: "https://paymongo.test/checkout/cs_777",
        checkoutSessionId: "cs_777",
        amount: 600,
      }),
    }));
    const started = await startBookingCheckout({
      bookingNumber: "RB-GUEST-1",
      guestToken: "secret-token",
    });
    expect(started.checkoutUrl).toContain("paymongo.test");
    expect(started.amount).toBe(600); // 2 hours — server-computed

    // 2) The player returns via ?paid=1; the browser polls the RPC. The mock
    //    emulates the webhook committing mid-poll.
    vi.stubGlobal("fetch", vi.fn()); // no more checkout calls
    const timeline = [
      { payment_status: "pending", booking_status: "upcoming" },
      { payment_status: "pending", booking_status: "upcoming" },
      { payment_status: "paid", booking_status: "confirmed" },
    ];
    let step = 0;
    __mocks.rpc.mockImplementation(async (_name, args) => {
      expect(args.p_booking_number).toBe("RB-GUEST-1");
      expect(args.p_token).toBe("secret-token");
      return {
        data: [timeline[Math.min(step++, timeline.length - 1)]],
        error: null,
      };
    });

    const messages = [];
    const { paid, state } = await waitForBookingPayment({
      bookingNumber: "RB-GUEST-1",
      guestToken: "secret-token",
      timeoutMs: 15000,
      intervalMs: 1,
      onTick: (s) => messages.push(bookingPaymentMessage(s)),
    });

    // 3) The verdict matches the webhook's commit, and the copy progresses.
    expect(paid).toBe(true);
    expect(state.paymentStatus).toBe("paid");
    expect(messages[0]).toMatch(/Waiting for PayMongo/);
    expect(messages[messages.length - 1]).toMatch(/Payment received/);
    // The poll never wrote anything: only the read RPC was used.
    expect(
      __mocks.rpc.mock.calls.every(
        ([name]) => name === "get_booking_payment_status",
      ),
    ).toBe(true);
  });
});
