import { type Address } from "viem";
import { encodeFunctionData, parseAbiItem } from "viem/utils";
import axios from "axios";

// Function to generate the calldata for the approve function
export function generateApproveCallData(spender: Address, amount: bigint) {
  // Generate the calldata for the approve function
  const approveCallData = encodeFunctionData({
    abi: [parseAbiItem("function approve(address spender, uint256 value)")],
    args: [spender, amount],
  });

  return approveCallData;
}

// Helper function to generate the call data for the swap function
export async function generateSwapCallData(
  userAddress: Address,
  amount: bigint,
  sellToken: Address,
  buyToken: Address,
  takerAddress: Address,
  destinationChainName: string
) {
  const quote = (
    await axios.get(
      `https://api.bebop.xyz/pmm/${destinationChainName}/v3/quote`,
      {
        params: {
          buy_tokens: buyToken.toString(),
          sell_tokens: sellToken,
          sell_amounts: amount.toString(),
          taker_address: takerAddress,
          receiver_address: userAddress,
          approval_type: "Standard",
          gasless: false,
          skip_validation: true,
        },
      }
    )
  ).data;

  if (quote.error !== undefined) {
    throw new Error(quote.error);
  }

  const { to, data } = quote.tx;
  return { to, data };
}
