import { createAcrossClient } from "@across-protocol/app-sdk";
import dotenv from "dotenv";
import { type Address, parseUnits, formatUnits } from "viem";
import { base, arbitrum } from "viem/chains";
import {
  generateApproveCallData,
  generateSwapCallData,
} from "./utils/transactions.js";
import {
  createUserWallet,
  createTransactionUrl,
  getBalance,
} from "./utils/helpers.js";
import { logger } from "./utils/logger.js";
import { type CrossChainMessage } from "./utils/types.js";

dotenv.config();

// Configuration constants
const INTEGRATOR_ID = "0x0065"; // Bebop integrator ID

// Route: WETH from Arbitrum -> WETH on Base
const route = {
  originChainId: arbitrum.id,
  destinationChainId: base.id,
  inputToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as Address, // WETH arb
  outputToken: "0x4200000000000000000000000000000000000006" as Address, // WETH base
};

// Input amount to be used for bridge transaction
// Amount scaled to inputToken decimals (18 decimals for WETH)
const WETH_DECIMALS = 18;
const inputAmount = parseUnits("0.003", WETH_DECIMALS);

// Bebop parameters for the quote
export const bebopParams = {
  // destination chain info for quote API
  destinationChain: {
    chainId: 8453,
    name: "base",
  },
  // buying USDC on base
  tokensAddressBuy: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  // Across multicall contract on base
  // set as taker address for quote with user address as recipient
  // if swap fails, the bridged tokens will be sent to the fallbackRecipient
  multicall: "0x924a9f036260DdD5808007E1AA95f08eD08aA569",
};

// Function to execute the swap
async function executeSwap() {
  if (!process.env.PRIVATE_KEY || !process.env.RPC_URL) {
    throw new Error("PRIVATE_KEY or RPC_URL is not set");
  }

  try {
    logger.step("Initializing clients");
    // Create a wallet client using the origin chain to make Across deposit transaction
    const { client: walletClient, address: userAddress } = createUserWallet(
      process.env.PRIVATE_KEY,
      process.env.RPC_URL,
      arbitrum
    );

    // Check if the user has enough balance to bridge
    const balance = await getBalance(arbitrum, userAddress, route.inputToken);
    if (balance < inputAmount) {
      throw new Error(
        `Insufficient balance. Required: ${formatUnits(
          inputAmount,
          WETH_DECIMALS
        )}, Available: ${formatUnits(balance, WETH_DECIMALS)}`
      );
    }
    logger.success(
      `Balance check passed. Available: ${formatUnits(balance, WETH_DECIMALS)}`
    );

    // sets up the AcrossClient and configures chains
    const client = createAcrossClient({
      integratorId: INTEGRATOR_ID,
      chains: [base, arbitrum],
    });

    logger.success("Clients initialized successfully");

    // Generates the inital swap calldata for the quote
    // This allows gas fees to be calculated
    const { to: swapContractAddress, data: initialCalldata } =
      await generateSwapCallData(
        userAddress, // user address
        inputAmount, // swap amount
        route.outputToken, // sell token
        bebopParams.tokensAddressBuy as Address, // buy token
        bebopParams.multicall as Address, // taker address
        bebopParams.destinationChain.name // destination chain name
      );

    // Define the transactions executed after bridge transaction
    const crossChainMessage: CrossChainMessage = {
      actions: [
        // Approve the swap contract to spend the input amount
        {
          target: route.outputToken,
          // Generate the approve call data
          callData: generateApproveCallData(
            swapContractAddress as Address,
            inputAmount
          ),
          value: 0n,
          // we use the update function to update the calldata based on the output amount from the quote
          update: (updatedOutputAmount: bigint) => {
            return {
              callData: generateApproveCallData(
                swapContractAddress as Address,
                updatedOutputAmount
              ),
            };
          },
        },
        {
          // Swap contract address
          target: swapContractAddress,
          // Uses initial calldata for the quote
          callData: initialCalldata,
          value: 0n,
          // we use the update function to update the calldata based on the output amount from the quote
          update: async (updatedOutputAmount: bigint) => {
            // Generates the updated swap calldata based on the output amount from the quote
            const { to: updatedSwapContractAddress, data: updatedCalldata } =
              await generateSwapCallData(
                userAddress,
                updatedOutputAmount,
                route.outputToken,
                bebopParams.tokensAddressBuy as Address,
                bebopParams.multicall as Address,
                bebopParams.destinationChain.name
              );

            // If the swap contract changes, throw an error
            if (swapContractAddress !== updatedSwapContractAddress) {
              throw new Error("Swap contract address mismatch");
            }

            return {
              // Updates calldata with the output amount from the quote
              callData: updatedCalldata,
            };
          },
        },
      ],
      // address to send the output token to if the swap fails
      fallbackRecipient: userAddress,
    };

    logger.step("Fetching quote");
    // Retrieves a quote for the bridge with approval and swap actions
    const quote = await client.getQuote({
      route,
      inputAmount: inputAmount,
      crossChainMessage: crossChainMessage,
    });

    logger.json("Quote parameters", quote.deposit);

    logger.step("Executing transactions");
    await client.executeQuote({
      walletClient,
      deposit: quote.deposit, // returned by `getQuote`
      onProgress: (progress) => {
        if (progress.step === "approve" && progress.status === "txSuccess") {
          // if approving an ERC20, you have access to the approval receipt
          const { txReceipt } = progress;
          logger.success(
            `Approve TX: ${createTransactionUrl(
              arbitrum,
              txReceipt.transactionHash
            )}`
          );
        }

        if (progress.step === "deposit" && progress.status === "txSuccess") {
          // once deposit is successful you have access to depositId and the receipt
          const { depositId, txReceipt } = progress;
          logger.success(
            `Deposit TX: ${createTransactionUrl(
              arbitrum,
              txReceipt.transactionHash
            )}`
          );
          logger.success(`Deposit ID: ${depositId}`);
        }

        if (progress.step === "fill" && progress.status === "txSuccess") {
          // if the fill is successful, you have access the following data
          const { txReceipt, actionSuccess } = progress;
          // actionSuccess is a boolean flag, telling us if your cross chain messages were successful
          logger.success(
            `Fill TX: ${createTransactionUrl(base, txReceipt.transactionHash)}`
          );
          logger.success(
            actionSuccess ? "Swap completed successfully" : "Swap failed"
          );
        }
      },
    });

    logger.step("Bridge transaction completed");
  } catch (error) {
    logger.error("Failed to execute swap", error);
    throw error;
  }
}

executeSwap();
