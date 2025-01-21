# TokenMill Backend

A Solana-based backend service for TokenMill, providing token management, staking, and vesting functionality.

## Overview

TokenMill Backend is an Express.js server that interfaces with the TokenMill Solana program, providing REST API endpoints for:
- Token creation and management
- Market operations
- Staking functionality
- Vesting schedules
- Configuration management

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Solana CLI tools
- A Solana wallet with some SOL for transactions

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd token-mill-be
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=JoeaRXgtME3jAoz5WuFXGEndfv4NPH9nBxsLq44hk9J
```

## Development

Start the development server:
```bash
npm run dev
```

Build the project:
```bash
npm run build
```

## API Endpoints

### Configuration
- `POST /api/config` - Create a new TokenMill configuration
  - Required body: `{ authority, protocolFeeRecipient, protocolFeeShare, referralFeeShare }`

### Token Operations
- `POST /api/quote-token-badge` - Get token badge quote
- `POST /api/tokens` - Create a new token
  - Required body: Token creation parameters

### Market Operations
- `POST /api/markets` - Create a new market
  - Required body: Market creation parameters

### Staking
- `POST /api/stake` - Create a new staking position
  - Required body: Staking parameters

### Vesting
- `POST /api/vesting` - Create a new vesting schedule
  - Required body: Vesting schedule parameters
- `POST /api/vesting/:marketAddress/claim` - Claim vested tokens
  - Required params: marketAddress
  - Required body: Claim parameters

## Project Structure

```
token-mill-be/
├── src/
│   ├── idl/            # Solana program interface definitions
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utility functions and classes
│   └── index.ts        # Main application entry point
├── dist/               # Compiled JavaScript output
├── .env               # Environment variables
└── package.json
```

## Dependencies

- `@coral-xyz/anchor` - Solana development framework
- `@solana/web3.js` - Solana web3 library
- `@solana/spl-token` - SPL Token program interactions
- `express` - Web server framework
- `typescript` - Type support
- Additional utilities: `big.js`, `bn.js`, `bs58`, `dotenv`

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

ISC License

## Support

For support, please open an issue in the repository or contact the maintainers.
