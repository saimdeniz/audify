// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const listDevicesMock = vi.fn();

vi.mock("../../services/nativeAudioClient", () => ({
  nativeAudioListDevices: () => listDevicesMock(),
}));

import { useSampleStore } from "../../store/useSampleStore";
import { AudioOutputDeviceRow } from "./AudioOutputDeviceRow";

describe("AudioOutputDeviceRow custom portal dropdown", () => {
  beforeEach(() => {
    listDevicesMock.mockResolvedValue([
      {
        id: "default",
        name: "System Default (Speakers (High Definition Audio Device))",
        isDefault: true,
      },
      {
        id: "Speakers (High Definition Audio Device)",
        name: "Speakers (High Definition Audio Device)",
        isDefault: true,
      },
      {
        id: "R25i-30 (NVIDIA High Definition Audio)",
        name: "R25i-30 (NVIDIA High Definition Audio)",
        isDefault: false,
      },
    ]);
    useSampleStore.setState({ audioOutputDeviceId: "default" });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens a themed portal listbox clamped inside the viewport and updates selected device", async () => {
    render(<AudioOutputDeviceRow />);

    await waitFor(() => {
      expect(listDevicesMock).toHaveBeenCalled();
    });

    const trigger = screen.getByRole("button", { name: "Audio output device" });
    fireEvent.click(trigger);

    const listbox = await screen.findByRole("listbox", {
      name: "Audio output device options",
    });
    expect(listbox.closest('[data-popover-portal="true"]')).not.toBeNull();
    expect(within(listbox).getByText("System Default")).toBeTruthy();

    const nvidiaOption = screen.getByRole("option", {
      name: /R25i-30 \(NVIDIA High Definition Audio\)/i,
    });
    fireEvent.click(nvidiaOption);

    expect(useSampleStore.getState().audioOutputDeviceId).toBe(
      "R25i-30 (NVIDIA High Definition Audio)"
    );
    expect(
      screen.queryByRole("listbox", { name: "Audio output device options" })
    ).toBeNull();
  });
});
