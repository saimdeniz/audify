// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "./AppErrorBoundary";

const CrashTrigger: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error("Simulated waveform crash");
  }
  return <div>Audify Healthy UI</div>;
};

describe("AppErrorBoundary", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders children normally when no error is thrown", () => {
    render(
      <AppErrorBoundary>
        <CrashTrigger shouldThrow={false} />
      </AppErrorBoundary>
    );
    expect(screen.getByText("Audify Healthy UI")).toBeTruthy();
  });

  it("catches render exceptions and recovers cleanly when Try Recover is clicked", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    let shouldThrow = true;
    const DynamicChild = () => <CrashTrigger shouldThrow={shouldThrow} />;

    const { rerender } = render(
      <AppErrorBoundary>
        <DynamicChild />
      </AppErrorBoundary>
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Audify Recovery Mode")).toBeTruthy();
    expect(screen.getByText("Simulated waveform crash")).toBeTruthy();

    shouldThrow = false;
    rerender(
      <AppErrorBoundary>
        <DynamicChild />
      </AppErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: "Try Recover" }));
    expect(screen.getByText("Audify Healthy UI")).toBeTruthy();
  });
});
