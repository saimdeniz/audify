import React from "react";
import { TransportControls } from "./transport/TransportControls";
import { WaveformDeckCanvas } from "./transport/WaveformDeckCanvas";

export const TopTransportDeck: React.FC = React.memo(() => {
  return (
    <section className="h-[104px] bg-surface-1 border-b border-line flex shrink-0 select-none">
      <TransportControls />
      <WaveformDeckCanvas />
    </section>
  );
});
