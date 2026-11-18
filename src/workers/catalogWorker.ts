/// <reference lib="webworker" />
import { createCatalogWorkerKernel } from "./catalogWorkerKernel";
import type { CatalogWorkerRequest } from "./catalogWorkerProtocol";

const kernel = createCatalogWorkerKernel();

self.onmessage = (event: MessageEvent<CatalogWorkerRequest>) => {
  const { response, transfer } = kernel.handleMessage(event.data);
  self.postMessage(response, { transfer });
};
