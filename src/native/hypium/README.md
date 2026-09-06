# Official UiTest text transport

These are unmodified device agents from the official hypium-driver 6.1.210 npm
release. See provenance.json and NOTICE.hypium for origin and license. They are
not built by deveco-tool and do not use a company's signing key. A custom native
extension was rejected by the production phone's loader; the official agent
loads successfully on that same phone.

The host uses only Node's built-in TCP support and HDC to call Driver.create and
Driver.inputText(point, text, {paste: true}). It does not load hypium-driver's
JavaScript runtime, telemetry, or optional dependencies. Text travels as UTF-8
JSON through a temporary HDC port forward, never through a shell argument or a
request file. Responses are bounded and decoded across TCP fragments.

Agent selection follows upstream: arm64 UiTest >= 6.0.2.2 uses v1.2.2 and a device
Unix socket; older arm64 uses v1.1.9 and TCP 8012; x86_64 uses its v1.1.9 agent and
TCP 8012. Other device architectures are explicitly unsupported. Actual forced
paste support also depends on the device UiTest version. Packaging an agent is
not proof of acceptance on every device or OS release.

An existing service is reused. Otherwise, a uniquely named agent is uploaded and
started without replacing /data/local/tmp/agent.so or killing other test
processes. Each call closes its RPC session and removes its port forward and
uploaded library. The official daemon is shared and uses upstream's idle exit;
it is not forcibly terminated when a text call ends. Older agents' TCP endpoint
has the same device-network exposure as upstream Hypium.

Input replaces the device clipboard and clicks the target before pasting. It
does not preserve the prior clipboard, caret, or selection. Apps can filter or
transform input. A successful API receipt means the operation was accepted;
inspect the field or use verify_ui to establish the application's outcome.
