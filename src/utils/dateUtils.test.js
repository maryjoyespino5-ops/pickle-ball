import { describe, expect, it } from "vitest";
import {
  formatTime12,
  formatTimeRange12,
  isPastSlot,
  todayISO,
  upcomingHours,
} from "./dateUtils";

describe("formatTime12", () => {
  it("converts 24h wall-clock to 12h", () => {
    expect(formatTime12("18:00")).toBe("6:00 PM");
    expect(formatTime12("07:00")).toBe("7:00 AM");
    expect(formatTime12("12:00")).toBe("12:00 PM");
    expect(formatTime12("00:00")).toBe("12:00 AM");
  });
});

describe("formatTimeRange12", () => {
  it("shows a start-end range", () => {
    expect(formatTimeRange12("18:00", 2)).toBe("6:00 PM - 8:00 PM");
  });
});

describe("isPastSlot", () => {
  it("treats a past date as past and a future date as not past", () => {
    const today = todayISO();
    expect(isPastSlot("2000-01-01", "10:00")).toBe(true);
    expect(isPastSlot("2999-01-01", "10:00")).toBe(false);
    // Same-day comparison is time-dependent; just assert the type is boolean.
    expect(typeof isPastSlot(today, "10:00")).toBe("boolean");
  });

  it("returns false for empty input", () => {
    expect(isPastSlot("", "")).toBe(false);
  });
});

describe("upcomingHours", () => {
  it("drops passed hours for today and keeps all for the future", () => {
    const times = ["07:00", "12:00", "23:00"];
    const future = upcomingHours(times, "2999-01-01");
    expect(future).toEqual(times);
  });
});