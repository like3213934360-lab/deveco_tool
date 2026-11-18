import https from "node:https";
import { invariant } from "../core/errors.js";

// Huawei CBG Application Integration CA, published with DevEco CLI's grs/ca-bundle.ts.
// Trust is limited to this GRS transport. Node verifies the hostname, signature and validity.
const grsCA = `-----BEGIN CERTIFICATE-----
MIIF/TCCA+WgAwIBAgIIIQV1CU5bvEMwDQYJKoZIhvcNAQELBQAwUDELMAkGA1UE
BhMCQ04xDzANBgNVBAoMBkh1YXdlaTETMBEGA1UECwwKSHVhd2VpIENCRzEbMBkG
A1UEAwwSSHVhd2VpIENCRyBSb290IENBMB4XDTE4MDEzMDA3NDI1OVoXDTM4MDEy
NTA3NDI1OVowYzELMAkGA1UEBhMCQ04xDzANBgNVBAoMBkh1YXdlaTETMBEGA1UE
CwwKSHVhd2VpIENCRzEuMCwGA1UEAwwlSHVhd2VpIENCRyBBcHBsaWNhdGlvbiBJ
bnRlZ3JhdGlvbiBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMCC
UUvjL5oXThUxFklLXbLNkfHtjs8rlOT3hRE3VmicI7LFJXGMCByB7ORucGDStwIM
H1ac1pnBsV2dabuQj0WiXbYtRD44IxCN879RJBFry9AV7PypYrxucFqgeqt19PpS
pSMa4ROBxAyVRq9F6m6HWlBTtlLXvH9yAbPOp+rvaEd5LD7MNsVFOXeMVBoRuhox
ohrAIB3pzwAjX8fWSoe8Vrz6F3LAIVHE1CzEn0sFUtKIuWVm1l1cGNlsMeUwSMwj
8PBtTNb9IQaNTsA2qguQgkdPaDda0ENg/FIZ2zHzV9l4k7SrpFvqSde0sEDR9mSf
IeJ3x5pATJp25X5K1+ZoFZRa7sQHMWA6HOYwfqBXxQmK0pETzjB5zVfXQLnDP0Tq
K1xcS8X6jJuvkm5F691nu7ypfmZx0RNPTnFZiNOz+Qdzklm1BJHlmNIVbFke6qHU
HOBX57EAsu2HumkWWyqQ0MaXcpuuLMdU3OZ6vtoSsYevNhN4Ypm2v0Zr3FCSjgnW
AwU02MNROMCBCRazt4txJ1tEYnmu0Bd5qLJXFWc1zweP52XS6BqeFRYb50M5O/AQ
I5sXsO10fWN05jezS7jDzqjar7PYNGHuuY6cO5QVo8/t9t/sZ8vHN++Et2BzMKm5
n11YM6tPJZKKpL0F+ZBa3qgEMFoNxwckvnmT79D5AgMBAAGjgccwgcQwHwYDVR0j
BBgwFoAUqsTTeUfobiNr7/CpbCJzPXoZaaEwHQYDVR0OBBYEFOHI/wFzBqHgXhMO
Wqee63/XnhuIMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMGEGA1Ud
HwRaMFgwVqBUoFKGUGh0dHA6Ly9jcGtpLWNhd2ViLmh1YXdlaS5jb20vY3BraS9z
ZXJ2bGV0L2NybEZpbGVEb3duLmNybD9jZXJ0eXBlPTEmL3Jvb3RjcmwuY3JsMA0G
CSqGSIb3DQEBCwUAA4ICAQDPxMXcr1lLbdPHfoncb/QzQpRCQx/EYd7c/7VUKaTX
V8k4JQ2Z0hHNPPHyjU8MkPg764d+UCcOMkI+PB+zXYKeumQsWks2YRHQQa93bLAO
NPo0Z8b/r9fjrklCExJT3kA2qThRA4BEfl4WydFS4J2kpdTFxtSbMI77DEllyF8L
1Nn5mqKCXgZGA3g6vgkxBM/gLaApV9/Mg2QEhTV9WA78+fCbgGVLCYELrvuc+MKl
jbBnOIoj49tz8VUbjoFJD6AcCBe00qbecDjvx31ERskziWMs+PZ4oNp2zMdsa3Br
E/vANlEbtTigmTHMora36tEL1JX1cKu+So7I6fykmsPZA3keDHp8treLb4KcbDpL
cqAu4V8vMqJ8tFU6ilh65HOATWz+g/jEpMPZuiN+qjSYnDFxzts9mWERsSG003S6
yg9ZnehcA3iRVNPZZ8hSZZH0YKNqxpda/TR6P5qXiHRA6A+MdoBOE4HmuUy3QFV7
zYl5snR6SmrDfVmtsyz8aMqifx4gsVV2M5/owv8H3bUdOd5RbkKhzOS2Pmep0bbw
WRFUrWuQ+5ci2LLkZyIt9ffNR8W9gbmZOZZTrwSFRIT1Q433NOzCQNDjKwnekGAx
8o746tqqZxGCXgy2MaIIqvajhNw9Dr3NBQ8ziWyqaQBk2RrCWh6Q++Sd0b5L3RwH
rQ==
-----END CERTIFICATE-----`;
const group = "com.huawei.devecostudio.region";
const keys = ["spaceintroduce", "agcups", "agcsign"] as const;
type Routes = Record<typeof keys[number], string>;
const cache = new Map<string, { until: number; routes: Routes }>();

export function regionalRoutes(body: string): Routes {
  let data;
  try { data = JSON.parse(body); } catch { invariant(false, "HTTP_ERROR", "GRS returned invalid JSON"); }
  invariant(data?.resultCode === 0 && data.services?.[group], "HTTP_ERROR", "GRS did not return DevEco endpoints");
  const routes = {} as Routes;
  for (const key of keys) {
    const value = data.services[group][key];
    invariant(typeof value === "string" && URL.canParse(value), "HTTP_ERROR", "GRS returned no valid service URL", { key });
    const url = new URL(value);
    invariant(url.protocol === "https:" && /\.(?:huawei\.com|dbankcloud\.(?:com|cn|asia))$/.test(url.hostname) &&
      !url.port && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
      "HTTP_ERROR", "GRS returned an invalid service origin", { key });
    routes[key] = url.origin;
  }
  return routes;
}

export async function resolveRegion(country: string, signal?: AbortSignal) {
  invariant(["HK", "MO", "SG", "RU", "EU"].includes(country), "INVALID_INPUT", "Unknown GRS country");
  signal?.throwIfAborted();
  const hit = cache.get(country);
  if (hit && hit.until > Date.now()) return hit.routes;
  const routes = await new Promise<Routes>((resolve, reject) => {
    const options = { method: "POST", ca: grsCA, allowPartialTrustChain: true, signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]) };
    const req = https.request("https://grs.dbankcloud.com/grs/2.0/router?issue_country=" + country + "&app_name=devecostudio", options, (res) => {
      void (async () => {
        invariant(res.statusCode === 200, "HTTP_ERROR", "GRS returned HTTP " + res.statusCode);
        let body = "";
        for await (const chunk of res.setEncoding("utf8")) {
          body += chunk;
          invariant(body.length <= 262144, "HTTP_ERROR", "GRS response too large");
        }
        resolve(regionalRoutes(body));
      })().catch(reject).finally(() => res.destroy());
    });
    req.on("error", reject).end();
  });
  cache.set(country, { until: Date.now() + 86400000, routes });
  return routes;
}
