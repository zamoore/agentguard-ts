# Contributing to AgentGuard

Thank you for your interest in contributing to AgentGuard! We welcome contributions from the community and are committed to making AgentGuard the best AI security toolkit available.

## 🚀 Quick Start

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies: `pnpm install`
4. **Create** a feature branch: `git checkout -b feature/amazing-feature`
5. **Make** your changes
6. **Test** your changes: `pnpm test`
7. **Commit** your changes: `git commit -m 'Add amazing feature'`
8. **Push** to your branch: `git push origin feature/amazing-feature`
9. **Open** a Pull Request

## 📜 Licensing & Contributions

### **Your Contributions**

By contributing to AgentGuard, you agree that your contributions will be licensed under the same **Business Source License 1.1** terms as the project.

### **What This Means**

- Your code will be **freely available** for legitimate use (securing AI agents)
- Your code will be **protected** from being used in competing products
- Your code will become **MIT licensed** on January 1, 2029
- You retain authorship credit for your contributions

### **Why BSL?**

We use BSL to ensure AgentGuard can continue to be developed and improved while preventing large companies from building competing products using our (and your) work. This protects both the project's future and the value of your contributions.

## 🛠️ Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/agentguard-node.git
cd agentguard-node

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build the project
pnpm build

# Run in development mode
pnpm dev
```

## 📁 Project Structure

```
src/
├── lib/           # Core library code
│   ├── agentguard.ts    # Main AgentGuard class
│   ├── policy-loader.ts # Policy loading logic
│   ├── hitl-manager.ts  # Human-in-the-loop workflows
│   ├── logger.ts        # Logging utilities
│   └── errors.ts        # Error definitions
├── types.ts       # TypeScript type definitions
├── index.ts       # Main exports
├── cli.ts         # Command line interface
└── version.ts     # Version information

tests/
├── unit/          # Unit tests
├── integration/   # Integration tests
└── performance/   # Performance tests
```

## 🎯 What We're Looking For

### **🔥 High Priority Contributions**

- **Bug fixes** - Help us squash bugs!
- **Security improvements** - Make AgentGuard more secure
- **Documentation** - Better docs help everyone
- **Policy examples** - Real-world policy configurations
- **Integration guides** - Show AgentGuard working with popular frameworks
- **Test coverage** - More tests = more confidence

### **⭐ Medium Priority Contributions**

- **Performance improvements** - Make AgentGuard faster
- **Developer experience** - Better error messages, tooling, etc.
- **Platform support** - Windows compatibility, different Node versions
- **New policy operators** - Extend the policy language capabilities
- **CLI improvements** - Better command-line experience

### **🚀 Advanced Contributions**

- **Alternative transports** - Beyond webhooks for approvals
- **Monitoring integrations** - Prometheus, DataDog, etc.
- **Agent framework integrations** - Direct integration with popular frameworks

### **💼 Enterprise Features (Special Note)**

If you're interested in contributing enterprise features (dashboards, SSO, analytics), please [reach out to us](mailto:enterprise@agentguard.dev) first. We're planning a dual-license model where enterprise features will be in a separate commercial package.

## 📝 Guidelines

### **Code Style**

- **TypeScript** - All code must be TypeScript
- **ESLint** - Follow the existing ESLint configuration
- **Prettier** - Use Prettier for code formatting
- **Tests** - Include tests for new functionality
- **Documentation** - Update JSDoc comments for public APIs

### **Commit Messages**

Use conventional commits format:

```
type(scope): description

Examples:
fix(policy): handle null values in conditions
feat(cli): add policy validation command
docs(readme): update installation instructions
test(hitl): add timeout handling tests
```

### **Pull Request Process**

1. **Update tests** - Add/update tests for your changes
2. **Update docs** - Update README, JSDoc comments as needed
3. **Check CI** - Ensure all tests and linting pass
4. **Small PRs** - Keep pull requests focused and manageable
5. **Describe changes** - Provide clear description of what and why

### **Testing**

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm test:unit
pnpm test:integration
pnpm test:performance

# Run tests with coverage
pnpm test:coverage

# Run tests in watch mode
pnpm test:watch
```

## 🐛 Bug Reports

- **Search existing issues** first
- **Use the bug report template** when creating new issues
- **Include reproduction steps** and minimal code examples
- **Provide system information** (Node version, OS, etc.)
- **Include relevant policy configurations** if applicable

## 💡 Feature Requests

- **Search existing issues** first
- **Use the feature request template**
- **Explain the use case** and why it's valuable
- **Consider if it fits AgentGuard's core mission** (AI security governance)
- **Discuss implementation approach** if you have ideas

## 📚 Documentation Contributions

- **Fix typos and unclear sections**
- **Add examples and use cases**
- **Improve API documentation**
- **Create integration guides** for popular frameworks
- **Write policy examples** for common scenarios

## 🤝 Community Guidelines

### **Be Respectful**

- **Inclusive language** - Welcome all backgrounds and experience levels
- **Constructive feedback** - Focus on the code/idea, not the person
- **Helpful attitude** - We're all learning and building together

### **Be Professional**

- **Stay on topic** - Keep discussions relevant to AgentGuard
- **No spam or self-promotion** - Unless directly relevant to the project
- **Follow GitHub's community guidelines**

## 🏆 Recognition

Contributors will be:

- **Listed in CHANGELOG.md** for significant contributions
- **Mentioned in release notes** when appropriate
- **Given credit** in relevant documentation
- **Invited to join discussions** about project direction
- **Considered for core team** for ongoing significant contributors

## 📞 Questions & Support

### **Technical Questions**

- **GitHub Discussions** for general questions
- **Issues** for bugs and feature requests
- **Discord** (coming soon!) for real-time chat

### **Licensing Questions**

- **Email**: [license@agentguard.dev](mailto:license@agentguard.dev)
- **See**: [LICENSE-FAQ.md](./LICENSE-FAQ.md)

### **Enterprise Contributions**

- **Email**: [enterprise@agentguard.dev](mailto:enterprise@agentguard.dev)
- For questions about contributing enterprise features

## 🚧 Development Tips

### **Local Testing with Different Agent Frameworks**

```bash
# Test with OpenAI tools
npm run test:integration -- --grep="openai"

# Test with Anthropic tools
npm run test:integration -- --grep="anthropic"

# Test with LangChain
npm run test:integration -- --grep="langchain"
```

### **Policy Development**

```bash
# Validate a policy file
pnpm build && node dist/cli.js validate my-policy.yaml

# Test a policy against a tool call
pnpm build && node dist/cli.js test my-policy.yaml tool_name param1=value1
```

### **Performance Testing**

```bash
# Run performance benchmarks
pnpm test:performance

# Profile a specific scenario
node --prof dist/test-performance.js
```

---

**Thank you for helping make AgentGuard better!** 🚀

Every contribution, no matter how small, helps make AI agents safer for everyone. We're excited to see what you'll build with us!
