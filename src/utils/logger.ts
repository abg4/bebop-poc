function bigIntReplacer(_key: string, value: any) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

export const logger = {
  divider: () => console.log("\n-----------------------------------\n"),

  step: (message: string) => {
    logger.divider();
    console.log(`🚀 ${message}`);
  },

  success: (message: string) => {
    console.log(`✅ ${message}`);
  },

  error: (message: string, error?: unknown) => {
    console.error(`❌ ${message}`);
    if (error) console.error(error);
  },

  json: (label: string, data: unknown) => {
    console.log(`📄 ${label}:`);
    console.log(JSON.stringify(data, bigIntReplacer, 2));
  },
};
