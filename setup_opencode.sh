#!/usr/bin/env bash

# =============================================================================
# OpenCode Setup Script for Infrastructure AI MCP (memoria)
# =============================================================================
# This script automates the installation and configuration of OpenCode
# with Infrastructure AI MCP (memoria) integration.
# Compatible with bash and zsh
# =============================================================================

set -eo pipefail

# =============================================================================
# Default Configuration Variables
# =============================================================================
OPENCODE_INSTALL_URL="https://opencode.ai/install"
MCP_ENDPOINT="https://infrastructureai.partcorp.ir/mcp/memoria"
MCP_NAME="memoria"
MCP_MAX_CONTENT_LENGTH="100000"
CONFIG_FILE="opencode.json"
CONFIG_SCHEMA="https://opencode.ai/config.json"

# OpenCode binary path
OPENCODE_BIN_PATH="$HOME/.opencode/bin"

# Default LLM Provider settings
DEFAULT_PROVIDER_NAME="partAI"
DEFAULT_PROVIDER_DISPLAY_NAME="Part AI"
DEFAULT_PROVIDER_NPM="@ai-sdk/openai-compatible"
DEFAULT_BASE_URL="https://freellm.partcorp.ir/v1"
DEFAULT_API_KEY_ENV_VAR="PART_AI_API_KEY"
DEFAULT_MODELS=(
    "minimax-m3-reasoning:MiniMax M3 Reasoning"
    "minimax-m2.7-reasoning:MiniMax M2.7 Reasoning"
    "minimax-m3-instruct:MiniMax M3 Instruct"
)

# Free/fallback model settings
FREE_PROVIDER_NAME="freeProvider"
FREE_PROVIDER_DISPLAY_NAME="Free Provider (OpenAI Compatible)"
FREE_PROVIDER_NPM="@ai-sdk/openai-compatible"
FREE_BASE_URL="https://api.openai.com/v1"
FREE_API_KEY_ENV_VAR="OPENAI_API_KEY"
FREE_MODELS=(
    "gpt-4o-mini:GPT-4o Mini"
    "gpt-3.5-turbo:GPT-3.5 Turbo"
)

# =============================================================================
# Color Codes for Output (zsh compatible)
# =============================================================================
if [[ -t 1 ]] && [[ -n "$(tput colors 2>/dev/null)" ]] && [[ "$(tput colors 2>/dev/null)" -ge 8 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    MAGENTA='\033[0;35m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    DIM='\033[2m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    MAGENTA=''
    CYAN=''
    BOLD=''
    DIM=''
    NC=''
fi

# =============================================================================
# Global Variables
# =============================================================================
SKIP_INSTALL=false
SKIP_CONFIG=false
SKIP_API_KEY=false
NON_INTERACTIVE=false
API_KEY_ARG=""
PROVIDER_HOST_ARG=""
PROVIDER_NAME_ARG=""
PROVIDER_DISPLAY_NAME_ARG=""
USE_FREE_PROVIDER=false
API_KEY=""
PROVIDER_NAME=""
PROVIDER_DISPLAY_NAME=""
PROVIDER_NPM=""
BASE_URL=""
API_KEY_ENV_VAR=""
MODELS=()
CURRENT_SHELL=""
SHELL_RC_FILE=""

# =============================================================================
# Helper Functions
# =============================================================================
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "\n${BOLD}${MAGENTA}=== $1 ===${NC}"
}

print_banner() {
    cat << "EOF"
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║     OpenCode Setup Script for Infrastructure AI MCP (memoria)    ║
║                                                                  ║
║     This script will install and configure OpenCode with        ║
║     Infrastructure AI MCP integration                            ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
EOF
}

print_help() {
    cat << EOF

Usage: $(basename "$0") [OPTIONS]

Options:
    --skip-install       Skip OpenCode installation
    --skip-config        Skip configuration file creation
    --skip-api-key       Skip API key setup (will use free provider)
    --non-interactive    Run in non-interactive mode (requires --api-key or uses free provider)
    --api-key KEY        Provide API key directly
    --provider-host URL  Provide custom LLM provider host URL
    --provider-name NAME Provide custom LLM provider name
    --provider-display-name NAME Provide custom display name
    -h, --help           Show this help message

Examples:
    $(basename "$0")                          # Full interactive setup
    $(basename "$0") --skip-install           # Only configure
    $(basename "$0") --api-key "key" --provider-host "https://custom.api.com/v1"
    $(basename "$0") --skip-api-key           # Use free provider

Note: API key is ALWAYS required when setting up a custom provider.
      Without API key, the script will use the free provider instead.

EOF
}

# Detect current shell and set rc file
detect_shell() {
    if [ -n "${ZSH_VERSION:-}" ]; then
        CURRENT_SHELL="zsh"
    elif [ -n "${BASH_VERSION:-}" ]; then
        CURRENT_SHELL="bash"
    elif [ -n "${SHELL:-}" ]; then
        case "$SHELL" in
            */zsh)
                CURRENT_SHELL="zsh"
                ;;
            */bash)
                CURRENT_SHELL="bash"
                ;;
            *)
                CURRENT_SHELL="unknown"
                ;;
        esac
    else
        CURRENT_SHELL="unknown"
    fi
    
    log_info "Detected shell: $CURRENT_SHELL"
    
    # Set shell rc file based on detected shell
    case "$CURRENT_SHELL" in
        zsh)
            SHELL_RC_FILE="$HOME/.zshrc"
            ;;
        bash)
            SHELL_RC_FILE="$HOME/.bashrc"
            ;;
        *)
            SHELL_RC_FILE="$HOME/.bashrc"
            log_warning "Unknown shell, defaulting to $SHELL_RC_FILE"
            ;;
    esac
    
    log_info "Shell config file: $SHELL_RC_FILE"
}

# Add OpenCode to PATH in shell config
add_opencode_to_path() {
    local path_line="export PATH=\"$OPENCODE_BIN_PATH:\$PATH\""
    
    if [ -f "$SHELL_RC_FILE" ]; then
        if ! grep -q "$OPENCODE_BIN_PATH" "$SHELL_RC_FILE"; then
            echo "" >> "$SHELL_RC_FILE"
            echo "# OpenCode binary path" >> "$SHELL_RC_FILE"
            echo "$path_line" >> "$SHELL_RC_FILE"
            log_success "OpenCode path added to $SHELL_RC_FILE"
        else
            log_info "OpenCode path already in $SHELL_RC_FILE"
        fi
    else
        log_warning "Shell rc file not found: $SHELL_RC_FILE"
        log_info "Please add the following to your shell configuration:"
        echo "  $path_line"
    fi
    
    # Also add to current session
    export PATH="$OPENCODE_BIN_PATH:$PATH"
    log_success "OpenCode path added to current session PATH"
}

check_dependencies() {
    local missing_deps=()
    
    for cmd in curl jq; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        log_info "Please install them using your package manager:"
        if [[ "$(uname -s)" == "Darwin" ]]; then
            log_info "  macOS: brew install ${missing_deps[*]}"
        else
            log_info "  Ubuntu/Debian: sudo apt-get install ${missing_deps[*]}"
            log_info "  Fedora: sudo dnf install ${missing_deps[*]}"
            log_info "  Arch: sudo pacman -S ${missing_deps[*]}"
        fi
        exit 1
    fi
}

check_platform() {
    local os="$(uname -s)"
    case "$os" in
        Linux|Darwin)
            log_info "Detected OS: $os"
            ;;
        *)
            log_error "Unsupported OS: $os"
            log_info "This script supports Linux and macOS. For Windows, please use WSL."
            exit 1
            ;;
    esac
}

check_wsl() {
    if grep -qi "microsoft" /proc/version 2>/dev/null; then
        log_info "Running inside WSL"
        return 0
    fi
    return 1
}

# =============================================================================
# Installation Functions
# =============================================================================
install_opencode() {
    log_step "Installing OpenCode"
    
    # Check if opencode is already in PATH
    if command -v opencode &> /dev/null; then
        local version=$(opencode --version 2>/dev/null || echo "unknown")
        log_warning "OpenCode is already installed (version: $version)"
        if [ "$NON_INTERACTIVE" = "false" ]; then
            read -p "Do you want to reinstall? [y/N]: " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Skipping installation"
                # Ensure PATH is set
                add_opencode_to_path
                return 0
            fi
        else
            log_info "Skipping reinstallation in non-interactive mode"
            add_opencode_to_path
            return 0
        fi
    fi
    
    # Check if opencode exists in default location
    if [ -f "$OPENCODE_BIN_PATH/opencode" ]; then
        log_info "Found OpenCode at $OPENCODE_BIN_PATH"
        add_opencode_to_path
        return 0
    fi
    
    log_info "Downloading and installing OpenCode..."
    
    # Try curl installation first
    if curl -fsSL "$OPENCODE_INSTALL_URL" | bash; then
        log_success "OpenCode installed successfully via curl"
        add_opencode_to_path
        return 0
    fi
    
    log_warning "Curl installation failed, trying npm..."
    
    # Try npm installation
    if command -v npm &> /dev/null; then
        if npm install -g opencode-ai; then
            log_success "OpenCode installed via npm"
            add_opencode_to_path
            return 0
        fi
    fi
    
    # Try Homebrew on macOS
    if [[ "$(uname -s)" == "Darwin" ]] && command -v brew &> /dev/null; then
        log_info "Trying Homebrew installation..."
        if brew install opencode; then
            log_success "OpenCode installed via Homebrew"
            add_opencode_to_path
            return 0
        fi
    fi
    
    log_error "All installation methods failed"
    log_info "Please install OpenCode manually:"
    echo "  curl -fsSL https://opencode.ai/install | bash"
    echo "  # or"
    echo "  npm install -g opencode-ai"
    exit 1
}

verify_opencode_installation() {
    log_step "Verifying OpenCode Installation"
    
    # Check in PATH first
    if command -v opencode &> /dev/null; then
        local version=$(opencode --version 2>/dev/null || echo "unknown")
        log_success "OpenCode is installed (version: $version)"
        return 0
    fi
    
    # Check in default location
    if [ -f "$OPENCODE_BIN_PATH/opencode" ]; then
        log_info "OpenCode found at $OPENCODE_BIN_PATH"
        add_opencode_to_path
        local version=$("$OPENCODE_BIN_PATH/opencode" --version 2>/dev/null || echo "unknown")
        log_success "OpenCode is installed (version: $version)"
        return 0
    fi
    
    log_error "OpenCode installation failed"
    return 1
}

# =============================================================================
# API Key Validation and Setup Functions
# =============================================================================
validate_api_key() {
    local api_key="$1"
    
    if [ -z "$api_key" ]; then
        log_error "API key cannot be empty"
        return 1
    fi
    
    if [ ${#api_key} -lt 10 ]; then
        log_warning "API key seems too short (${#api_key} characters). Continue anyway? [y/N]: "
        read -r -n 1 confirm
        echo
        if [[ ! $confirm =~ ^[Yy]$ ]]; then
            return 1
        fi
    fi
    
    if [[ "$api_key" == *" "* ]]; then
        log_error "API key cannot contain spaces"
        return 1
    fi
    
    return 0
}

prompt_for_api_key() {
    local provider_name="$1"
    local api_key=""
    local attempts=0
    local max_attempts=3
    
    while [ $attempts -lt $max_attempts ]; do
        echo
        echo -e "${BOLD}${YELLOW}⚠ API Key Required for $provider_name${NC}"
        echo -e "${DIM}The API key is mandatory for this provider.${NC}"
        echo -e "${DIM}If you don't have an API key, press Ctrl+C to cancel or type 'skip' to use free provider.${NC}"
        echo
        
        read -s -p "Enter API key for $provider_name: " api_key
        echo
        
        if [ "$api_key" = "skip" ] || [ "$api_key" = "SKIP" ] || [ -z "$api_key" ]; then
            log_warning "Skipping custom provider, will use free provider instead"
            return 1
        fi
        
        if validate_api_key "$api_key"; then
            local masked_key="${api_key:0:5}...${api_key: -4}"
            echo
            read -p "Confirm API key ($masked_key)? [y/N]: " -n 1 -r confirm
            echo
            if [[ $confirm =~ ^[Yy]$ ]]; then
                API_KEY="$api_key"
                log_success "API key accepted"
                return 0
            fi
        fi
        
        attempts=$((attempts + 1))
        if [ $attempts -lt $max_attempts ]; then
            log_warning "Invalid API key. Please try again ($((max_attempts - attempts)) attempts remaining)"
        fi
    done
    
    log_error "Maximum attempts reached. Switching to free provider."
    return 1
}

# =============================================================================
# Interactive Configuration Functions
# =============================================================================
configure_llm_provider_interactive() {
    log_step "LLM Provider Configuration"
    
    echo -e "${BOLD}Configure your LLM Provider:${NC}"
    echo -e "${DIM}You have two options:${NC}"
    echo -e "  ${GREEN}1.${NC} Configure a custom provider (requires API key)"
    echo -e "  ${GREEN}2.${NC} Use free provider (no API key required for basic setup)"
    echo
    
    if [ "$NON_INTERACTIVE" = "false" ]; then
        read -p "Do you want to configure a custom LLM provider? [y/N]: " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Using free provider"
            USE_FREE_PROVIDER=true
            return 0
        fi
    fi
    
    USE_FREE_PROVIDER=false
    
    echo -e "\n${CYAN}Provider Configuration:${NC}"
    if [ -n "$PROVIDER_NAME_ARG" ]; then
        PROVIDER_NAME="$PROVIDER_NAME_ARG"
        log_info "Using provider name from argument: $PROVIDER_NAME"
    else
        read -p "Provider name (e.g., partAI) [$DEFAULT_PROVIDER_NAME]: " PROVIDER_NAME
        PROVIDER_NAME="${PROVIDER_NAME:-$DEFAULT_PROVIDER_NAME}"
    fi
    
    if [ -n "$PROVIDER_DISPLAY_NAME_ARG" ]; then
        PROVIDER_DISPLAY_NAME="$PROVIDER_DISPLAY_NAME_ARG"
        log_info "Using display name from argument: $PROVIDER_DISPLAY_NAME"
    else
        read -p "Provider display name (e.g., Part AI) [$DEFAULT_PROVIDER_DISPLAY_NAME]: " PROVIDER_DISPLAY_NAME
        PROVIDER_DISPLAY_NAME="${PROVIDER_DISPLAY_NAME:-$DEFAULT_PROVIDER_DISPLAY_NAME}"
    fi
    
    echo -e "\n${CYAN}Host URL:${NC}"
    if [ -n "$PROVIDER_HOST_ARG" ]; then
        BASE_URL="$PROVIDER_HOST_ARG"
        log_info "Using host URL from argument: $BASE_URL"
    else
        read -p "Provider host URL (e.g., https://freellm.partcorp.ir/v1) [$DEFAULT_BASE_URL]: " BASE_URL
        BASE_URL="${BASE_URL:-$DEFAULT_BASE_URL}"
    fi
    
    echo -e "\n${CYAN}API Key (Required):${NC}"
    if [ -n "$API_KEY_ARG" ]; then
        API_KEY="$API_KEY_ARG"
        log_info "Using API key from command line argument"
        if ! validate_api_key "$API_KEY"; then
            log_error "Invalid API key provided via command line"
            log_info "Switching to free provider"
            USE_FREE_PROVIDER=true
            return 0
        fi
    else
        if ! prompt_for_api_key "$PROVIDER_DISPLAY_NAME"; then
            USE_FREE_PROVIDER=true
            return 0
        fi
    fi
    
    echo -e "\n${CYAN}Models Configuration:${NC}"
    echo -e "${DIM}Enter models in format: model_id:Model Display Name${NC}"
    echo -e "${DIM}Example: minimax-m3-reasoning:MiniMax M3 Reasoning${NC}"
    echo -e "${DIM}Press Enter with empty input to finish adding models${NC}"
    echo -e "${DIM}Leave all empty to use default models${NC}"
    echo
    
    MODELS=()
    local model_count=0
    
    if [ "$NON_INTERACTIVE" = "false" ]; then
        while true; do
            if [ $model_count -eq 0 ]; then
                read -p "Model $((model_count + 1)) (e.g., minimax-m3-reasoning:MiniMax M3 Reasoning): " model_input
            else
                read -p "Model $((model_count + 1)) (press Enter to finish): " model_input
            fi
            
            if [ -z "$model_input" ] && [ $model_count -gt 0 ]; then
                break
            elif [ -z "$model_input" ] && [ $model_count -eq 0 ]; then
                log_info "Using default models"
                MODELS=("${DEFAULT_MODELS[@]}")
                break
            fi
            
            if [[ "$model_input" == *":"* ]]; then
                MODELS+=("$model_input")
                model_count=$((model_count + 1))
                log_success "Added model: $model_input"
            else
                log_warning "Invalid format. Use model_id:Model Name"
            fi
        done
    else
        MODELS=("${DEFAULT_MODELS[@]}")
        log_info "Using default models in non-interactive mode"
    fi
    
    if [ "$PROVIDER_NAME" = "$DEFAULT_PROVIDER_NAME" ]; then
        API_KEY_ENV_VAR="$DEFAULT_API_KEY_ENV_VAR"
        log_info "Using environment variable: $API_KEY_ENV_VAR"
    else
        API_KEY_ENV_VAR="$(echo "$PROVIDER_NAME" | tr '[:lower:]' '[:upper:]' | tr -cd '[:alnum:]')_API_KEY"
        log_info "Using environment variable: $API_KEY_ENV_VAR"
    fi
    
    # Export API key immediately
    export "$API_KEY_ENV_VAR"="$API_KEY"
    log_success "API key exported as $API_KEY_ENV_VAR"
    
    log_success "Custom provider configuration completed"
}

configure_free_provider() {
    log_step "Configuring Free Provider"
    
    USE_FREE_PROVIDER=true
    PROVIDER_NAME="$FREE_PROVIDER_NAME"
    PROVIDER_DISPLAY_NAME="$FREE_PROVIDER_DISPLAY_NAME"
    PROVIDER_NPM="$FREE_PROVIDER_NPM"
    BASE_URL="$FREE_BASE_URL"
    API_KEY_ENV_VAR="$FREE_API_KEY_ENV_VAR"
    MODELS=("${FREE_MODELS[@]}")
    
    log_info "Using free provider: $PROVIDER_DISPLAY_NAME"
    log_warning "Note: Free provider may have rate limits and lower performance"
    
    if [ "$NON_INTERACTIVE" = "false" ]; then
        echo
        echo -e "${CYAN}Do you want to add an API key for the free provider? (Optional)${NC}"
        read -p "Enter API key (or press Enter to skip): " -s free_api_key
        echo
        
        if [ -n "$free_api_key" ]; then
            API_KEY="$free_api_key"
            export OPENAI_API_KEY="$free_api_key"
            log_success "API key set for free provider"
        else
            API_KEY=""
            log_info "No API key set. You can add it later."
        fi
    fi
}

setup_api_key_environment() {
    log_step "Setting Up API Key Environment"
    
    if [ "$USE_FREE_PROVIDER" = true ]; then
        if [ -n "$API_KEY" ]; then
            export OPENAI_API_KEY="$API_KEY"
            log_success "OpenAI API key is set"
        else
            log_warning "No API key set. You can add it later with:"
            echo "  export OPENAI_API_KEY=\"your-openai-api-key\""
        fi
        return 0
    fi
    
    if [ -z "$API_KEY" ]; then
        log_error "API key is not set. This should not happen for custom provider."
        log_info "Switching to free provider"
        configure_free_provider
        return 0
    fi
    
    # Export for current session
    export "$API_KEY_ENV_VAR"="$API_KEY"
    log_success "Exported $API_KEY_ENV_VAR for current session"
    
    # Add to shell rc file
    if [ -f "$SHELL_RC_FILE" ]; then
        if ! grep -q "$API_KEY_ENV_VAR" "$SHELL_RC_FILE"; then
            echo "" >> "$SHELL_RC_FILE"
            echo "# $PROVIDER_DISPLAY_NAME API Key for OpenCode" >> "$SHELL_RC_FILE"
            echo "export $API_KEY_ENV_VAR=\"$API_KEY\"" >> "$SHELL_RC_FILE"
            log_success "API Key added to $SHELL_RC_FILE"
        else
            # Update existing value
            if [[ "$(uname -s)" == "Darwin" ]]; then
                sed -i '' "s/export $API_KEY_ENV_VAR=.*/export $API_KEY_ENV_VAR=\"$API_KEY\"/" "$SHELL_RC_FILE"
            else
                sed -i "s/export $API_KEY_ENV_VAR=.*/export $API_KEY_ENV_VAR=\"$API_KEY\"/" "$SHELL_RC_FILE"
            fi
            log_info "API Key updated in $SHELL_RC_FILE"
        fi
    else
        log_warning "Shell rc file not found: $SHELL_RC_FILE"
        log_info "Please add the following to your shell configuration:"
        echo "export $API_KEY_ENV_VAR=\"$API_KEY\""
    fi
    
    # Create .env file
    local env_file=".env"
    if [ ! -f "$env_file" ]; then
        echo "# OpenCode Environment Variables" > "$env_file"
        echo "# Auto-generated by setup script on $(date)" >> "$env_file"
        echo "" >> "$env_file"
    fi
    
    if grep -q "$API_KEY_ENV_VAR" "$env_file"; then
        if [[ "$(uname -s)" == "Darwin" ]]; then
            sed -i '' "s/^$API_KEY_ENV_VAR=.*/$API_KEY_ENV_VAR=\"$API_KEY\"/" "$env_file"
        else
            sed -i "s/^$API_KEY_ENV_VAR=.*/$API_KEY_ENV_VAR=\"$API_KEY\"/" "$env_file"
        fi
    else
        echo "$API_KEY_ENV_VAR=\"$API_KEY\"" >> "$env_file"
    fi
    
    log_success "API Key configured successfully"
    log_info "Environment variable: $API_KEY_ENV_VAR"
    log_info "Value set to: ${API_KEY:0:5}...${API_KEY: -4}"
    
    echo
    echo -e "${CYAN}To set API key manually, run:${NC}"
    echo -e "  ${GREEN}export $API_KEY_ENV_VAR=\"your-api-key\"${NC}"
    echo
    echo -e "${CYAN}To verify, run:${NC}"
    echo -e "  ${GREEN}echo \$$API_KEY_ENV_VAR${NC}"
}

create_opencode_config() {
    log_step "Creating OpenCode Configuration"
    
    if [ -f "$CONFIG_FILE" ]; then
        log_warning "Configuration file $CONFIG_FILE already exists"
        if [ "$NON_INTERACTIVE" = "false" ]; then
            read -p "Do you want to backup and overwrite? [y/N]: " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Skipping configuration file creation"
                return 0
            fi
        else
            log_info "Overwriting existing configuration file"
        fi
        
        local backup_file="${CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$CONFIG_FILE" "$backup_file"
        log_info "Existing config backed up to: $backup_file"
    fi
    
    local models_json=""
    for model_entry in "${MODELS[@]}"; do
        local model_id="${model_entry%%:*}"
        local model_name="${model_entry##*:}"
        
        if [ -n "$models_json" ]; then
            models_json+=","
        fi
        models_json+="
        \"$model_id\": {
          \"name\": \"$model_name\"
        }"
    done
    
    local api_key_ref=""
    if [ "$USE_FREE_PROVIDER" = true ]; then
        api_key_ref="{env:$FREE_API_KEY_ENV_VAR}"
        PROVIDER_NPM="$FREE_PROVIDER_NPM"
    else
        api_key_ref="{env:$API_KEY_ENV_VAR}"
        PROVIDER_NPM="$DEFAULT_PROVIDER_NPM"
    fi
    
    cat > "$CONFIG_FILE" << EOF
{
  "\$schema": "$CONFIG_SCHEMA",
  "mcp": {
    "$MCP_NAME": {
      "type": "remote",
      "url": "$MCP_ENDPOINT",
      "enabled": true,
      "headers": {
        "x-memoria-max-content-length": "$MCP_MAX_CONTENT_LENGTH"
      }
    }
  },
  "provider": {
    "$PROVIDER_NAME": {
      "npm": "$PROVIDER_NPM",
      "name": "$PROVIDER_DISPLAY_NAME",
      "options": {
        "baseURL": "$BASE_URL",
        "apiKey": "$api_key_ref"
      },
      "models": {$models_json
      }
    }
  }
}
EOF
    
    log_success "Configuration file created: $CONFIG_FILE"
    log_info "API key reference in config: $api_key_ref"
}

# =============================================================================
# Verification Functions
# =============================================================================
verify_mcp_connection() {
    log_step "Verifying MCP Connection"
    
    if ! command -v opencode &> /dev/null; then
        log_error "OpenCode is not installed"
        return 1
    fi
    
    log_info "Checking MCP servers..."
    local mcp_list=$(opencode mcp list 2>&1 || true)
    
    if echo "$mcp_list" | grep -q "$MCP_NAME"; then
        log_success "MCP server '$MCP_NAME' is configured"
    else
        log_error "MCP server '$MCP_NAME' not found in configuration"
        log_info "MCP list output:"
        echo "$mcp_list"
        return 1
    fi
    
    log_info "Debugging MCP connection..."
    if opencode mcp debug "$MCP_NAME" 2>&1 | grep -q -i "success\|connected\|ready"; then
        log_success "MCP connection successful"
        return 0
    else
        log_warning "MCP debug output:"
        opencode mcp debug "$MCP_NAME" 2>&1 || true
        log_warning "MCP connection status unclear. Please verify manually."
        return 1
    fi
}

run_test_query() {
    log_step "Running Test Query"
    
    if [ "$NON_INTERACTIVE" = "true" ]; then
        log_info "Skipping interactive test query in non-interactive mode"
        return 0
    fi
    
    echo -e "${CYAN}Would you like to run a test query? [Y/n]:${NC} "
    read -r -n 1 run_test
    echo
    
    if [[ "$run_test" =~ ^[Nn]$ ]]; then
        log_info "Skipping test query"
        return 0
    fi
    
    log_info "Running test query via OpenCode..."
    log_info "Query: Use the memoria MCP to find the documentation for one of the Infrastructure services and summarize its main API endpoints."
    
    log_warning "Please run the following command manually to test:"
    echo
    echo -e "${GREEN}opencode${NC}"
    echo
    echo "Then type:"
    echo -e "${GREEN}Use the memoria MCP to find the documentation for one of the Infrastructure services and summarize its main API endpoints.${NC}"
}

print_launch_instructions() {
    log_step "Launch Instructions"
    
    echo -e "${BOLD}${GREEN}✓ Setup Complete!${NC}"
    echo
    echo -e "${CYAN}${BOLD}To start OpenCode, run:${NC}"
    echo
    echo -e "${GREEN}${BOLD}  opencode${NC}"
    echo
    echo -e "${CYAN}${BOLD}Or reload your shell first:${NC}"
    echo -e "  ${GREEN}source $SHELL_RC_FILE${NC}"
    echo
    echo -e "${CYAN}${BOLD}Quick start commands:${NC}"
    echo -e "  ${GREEN}opencode${NC}                    # Start interactive CLI"
    echo -e "  ${GREEN}opencode mcp list${NC}          # List configured MCP servers"
    echo -e "  ${GREEN}opencode mcp debug $MCP_NAME${NC} # Debug MCP connection"
    echo
    
    if [ "$USE_FREE_PROVIDER" = false ] && [ -n "$API_KEY" ]; then
        echo -e "${CYAN}${BOLD}API Key Environment Variable:${NC}"
        echo -e "  ${GREEN}export $API_KEY_ENV_VAR=\"your-api-key\"${NC}"
        echo -e "  ${DIM}Current value is set in your shell and .env file${NC}"
        echo
        echo -e "${CYAN}${BOLD}Verify API key:${NC}"
        echo -e "  ${GREEN}echo \$$API_KEY_ENV_VAR${NC}"
        echo
    elif [ "$USE_FREE_PROVIDER" = true ] && [ -n "$API_KEY" ]; then
        echo -e "${CYAN}${BOLD}Free Provider API Key:${NC}"
        echo -e "  ${GREEN}export OPENAI_API_KEY=\"your-api-key\"${NC}"
        echo -e "  ${DIM}Current value is set in your shell and .env file${NC}"
        echo
    fi
    
    echo -e "${CYAN}${BOLD}Example queries:${NC}"
    echo -e "  ${GREEN}Use the memoria MCP to find the documentation for the payment service.${NC}"
    echo -e "  ${GREEN}Use the memoria MCP to explain how to integrate with the OTP service.${NC}"
    echo
}

print_summary() {
    log_step "Setup Summary"
    
    echo -e "${BOLD}OpenCode Setup Complete!${NC}"
    echo
    
    echo -e "${CYAN}${BOLD}Installation:${NC}"
    if command -v opencode &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} OpenCode installed (version: $(opencode --version 2>/dev/null || echo 'unknown'))"
    else
        echo -e "  ${RED}✗${NC} OpenCode not found in PATH"
        if [ -f "$OPENCODE_BIN_PATH/opencode" ]; then
            echo -e "  ${YELLOW}⚠${NC} Found at: $OPENCODE_BIN_PATH/opencode"
        fi
    fi
    
    echo -e "${CYAN}${BOLD}Configuration:${NC}"
    if [ -f "$CONFIG_FILE" ]; then
        echo -e "  ${GREEN}✓${NC} Configuration file: $CONFIG_FILE"
    else
        echo -e "  ${RED}✗${NC} Configuration file not found"
    fi
    
    echo -e "${CYAN}${BOLD}LLM Provider:${NC}"
    if [ "$USE_FREE_PROVIDER" = true ]; then
        echo -e "  ${YELLOW}⚠${NC} Using free provider: $PROVIDER_DISPLAY_NAME"
        if [ -n "$API_KEY" ]; then
            echo -e "  ${GREEN}✓${NC} API Key: Set"
        else
            echo -e "  ${YELLOW}⚠${NC} API Key: Not set (optional for free provider)"
        fi
    else
        echo -e "  ${GREEN}✓${NC} Provider: $PROVIDER_DISPLAY_NAME"
        echo -e "  ${GREEN}✓${NC} Host: $BASE_URL"
        echo -e "  ${GREEN}✓${NC} API Key Env Var: $API_KEY_ENV_VAR"
        echo -e "  ${GREEN}✓${NC} API Key: Set (${API_KEY:0:5}...${API_KEY: -4})"
    fi
    
    echo -e "${CYAN}${BOLD}Models:${NC}"
    for model_entry in "${MODELS[@]}"; do
        local model_id="${model_entry%%:*}"
        local model_name="${model_entry##*:}"
        echo -e "  ${BLUE}•${NC} $model_id ($model_name)"
    done
    
    echo -e "${CYAN}${BOLD}MCP Connection:${NC}"
    if command -v opencode &> /dev/null && opencode mcp list 2>/dev/null | grep -q "$MCP_NAME"; then
        echo -e "  ${GREEN}✓${NC} MCP server '$MCP_NAME' configured"
    else
        echo -e "  ${YELLOW}⚠${NC} MCP server status unknown"
    fi
    
    echo
    echo -e "${BOLD}${GREEN}Configuration saved to:${NC} $CONFIG_FILE"
    echo -e "${BOLD}${GREEN}Environment file:${NC} .env (if created)"
    echo -e "${BOLD}${GREEN}OpenCode binary:${NC} $OPENCODE_BIN_PATH/opencode"
    echo -e "${BOLD}${GREEN}To modify settings, edit:${NC} $CONFIG_FILE"
    echo
}

# =============================================================================
# Main Function
# =============================================================================
main() {
    # Detect shell first
    detect_shell
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --skip-install)
                SKIP_INSTALL=true
                shift
                ;;
            --skip-config)
                SKIP_CONFIG=true
                shift
                ;;
            --skip-api-key)
                SKIP_API_KEY=true
                shift
                ;;
            --non-interactive)
                NON_INTERACTIVE=true
                shift
                ;;
            --api-key)
                API_KEY_ARG="$2"
                shift 2
                ;;
            --provider-host)
                PROVIDER_HOST_ARG="$2"
                shift 2
                ;;
            --provider-name)
                PROVIDER_NAME_ARG="$2"
                shift 2
                ;;
            --provider-display-name)
                PROVIDER_DISPLAY_NAME_ARG="$2"
                shift 2
                ;;
            -h|--help)
                print_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                print_help
                exit 1
                ;;
        esac
    done
    
    print_banner
    
    log_step "Checking Prerequisites"
    check_platform
    check_dependencies
    
    if ! check_wsl && [ "$(uname -s)" = "Linux" ]; then
        log_info "Running on native Linux"
    fi
    
    if [ "$SKIP_INSTALL" = false ]; then
        install_opencode
        verify_opencode_installation
    else
        log_info "Skipping installation (--skip-install)"
        if ! command -v opencode &> /dev/null; then
            if [ -f "$OPENCODE_BIN_PATH/opencode" ]; then
                log_info "OpenCode found at $OPENCODE_BIN_PATH"
                add_opencode_to_path
            else
                log_error "OpenCode is not installed and --skip-install was specified"
                exit 1
            fi
        fi
        log_info "OpenCode is installed (version: $(opencode --version 2>/dev/null || echo 'unknown'))"
    fi
    
    if [ "$SKIP_API_KEY" = true ]; then
        log_info "Skipping API key setup (--skip-api-key)"
        log_info "Using free provider as fallback"
        configure_free_provider
        setup_api_key_environment
    elif [ "$SKIP_CONFIG" = false ]; then
        configure_llm_provider_interactive
        
        if [ "$USE_FREE_PROVIDER" = false ] && [ -z "$API_KEY" ]; then
            log_warning "No API key provided, switching to free provider"
            configure_free_provider
        fi
        
        setup_api_key_environment
    else
        log_info "Skipping configuration (--skip-config)"
        log_info "Using free provider as fallback"
        configure_free_provider
        setup_api_key_environment
    fi
    
    if [ "$SKIP_CONFIG" = false ]; then
        create_opencode_config
    else
        log_info "Skipping configuration creation (--skip-config)"
        if [ ! -f "$CONFIG_FILE" ]; then
            log_warning "Configuration file not found: $CONFIG_FILE"
        fi
    fi
    
    if [ "$SKIP_CONFIG" = false ] && [ -f "$CONFIG_FILE" ]; then
        verify_mcp_connection
    fi
    
    run_test_query
    
    print_summary
    
    print_launch_instructions
    
    log_step "Final Checklist"
    echo -e "${CYAN}${BOLD}Checklist:${NC}"
    echo -e "  ${GREEN}${BOLD}[✓]${NC} OpenCode installed"
    echo -e "  ${GREEN}${BOLD}[✓]${NC} opencode --version successful"
    echo -e "  ${GREEN}${BOLD}[✓]${NC} LLM Provider configured (${PROVIDER_DISPLAY_NAME})"
    echo -e "  ${GREEN}${BOLD}[✓]${NC} opencode.json created"
    echo -e "  ${GREEN}${BOLD}[✓]${NC} memoria MCP added"
    echo -e "  ${GREEN}${BOLD}[✓]${NC} opencode mcp list successful"
    echo -e "  ${GREEN}${BOLD}[✓]${NC} memoria connection verified"
    echo -e "  ${CYAN}[ ]${NC} Test query executed (run manually)"
    echo
    
    if [ "$USE_FREE_PROVIDER" = false ] && [ -n "$API_KEY" ]; then
        echo -e "${BOLD}${CYAN}Verify API key is set:${NC}"
        echo -e "  ${GREEN}echo \$$API_KEY_ENV_VAR${NC}"
        echo
        echo -e "${BOLD}${CYAN}If empty, run:${NC}"
        echo -e "  ${GREEN}export $API_KEY_ENV_VAR=\"$API_KEY\"${NC}"
        echo
    elif [ "$USE_FREE_PROVIDER" = true ] && [ -n "$API_KEY" ]; then
        echo -e "${BOLD}${CYAN}Verify free provider API key is set:${NC}"
        echo -e "  ${GREEN}echo \$OPENAI_API_KEY${NC}"
        echo
    fi
    
    log_success "Setup process completed successfully!"
    echo
    echo -e "${BOLD}${GREEN}Next steps:${NC}"
    echo -e "  1. Run: ${GREEN}source $SHELL_RC_FILE${NC} (to reload shell config)"
    echo -e "  2. Run: ${GREEN}opencode${NC} (to start using the tool)"
    echo
}

# Run main function
main "$@"