export const KernelFactory = [
  {
    inputs: [{ internalType: "address", name: "_impl", type: "address" }],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  { inputs: [], name: "InitializeError", type: "error" },
  {
    inputs: [
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "bytes32", name: "salt", type: "bytes32" },
    ],
    name: "createAccount",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes", name: "data", type: "bytes" },
      { internalType: "bytes32", name: "salt", type: "bytes32" },
    ],
    name: "getAddress",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "implementation",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];