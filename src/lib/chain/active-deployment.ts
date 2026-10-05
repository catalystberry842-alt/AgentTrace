import { deployment as testnetDeployment } from "@/lib/chain/deployment";
import { mainnetDeployment } from "@/lib/chain/deployment-mainnet";
import { IS_MAINNET } from "@/lib/chain/network";

/** Deployment record for the network this build serves. Both records are written by the deploy script. */
export const deployment = (IS_MAINNET ? mainnetDeployment : testnetDeployment) as Omit<typeof testnetDeployment, "chainId"> & {
  chainId: number;
};
