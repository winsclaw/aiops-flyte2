import { describe, expect, it } from "vitest";
import {
  authenticateAioneRequest,
  buildAioneCreateInstanceResponse,
  buildAioneInstanceAccessInfo,
  buildAioneInstanceValues,
  buildDockerConfigJson,
  buildExternalSecretName,
  buildWorkspaceLabels,
} from "./helpers";

const basePayload = {
  org: "external-org",
  project: "aione",
  domain: "development",
  name: "开发实例一",
  id: "ins-og2bgwm130xq3o6uk3h4956la6",
  timeout: 1,
  imageType: "BASE",
  baseImage: {
    image: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
    imageKey: "gonglijie",
    imageSecret: "Founder123",
    mountPath: "/data/lib1",
  },
  codes: [
    {
      id: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
      branch: "master",
      path: "/data/js-sample",
      token: "repo-token",
    },
  ],
  datastores: [
    {
      id: "stg-2i63j4q0z319cb63mw90qnt2mt",
      path: "/data/mystore2",
      size: 2,
    },
  ],
  resourceDefinition: {
    cpu: "2",
    memory: "4Gi",
    gpu: 1,
    gpu_key: "nvidia.com/gpu.present",
  },
};

describe("aione external instance helpers", () => {
  it("maps the external payload without leaking source org or secrets into Flyte identifiers", () => {
    const mapped = buildAioneInstanceValues({
      payload: basePayload,
      nodePort: 31000,
      codeServerNodePort: 31001,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
    });

    expect(mapped.runName).toBe("ins-og2bgwm130xq3o6uk3h4956la6");
    expect(mapped.values.org).toBe("aione");
    expect(mapped.values.project).toBe("aione");
    expect(mapped.values.domain).toBe("development");
    expect(mapped.values.maxHours).toBe(1);
    expect(mapped.values.image).toBe(
      "docker.fzyun.io/founder/aione.ide:1.0.0.60",
    );
    expect(mapped.values.baseImageMountPath).toBe("/data/lib1");
    expect(mapped.values.sourceOrg).toBe("external-org");
    expect(mapped.values.sourceInstanceId).toBe(
      "ins-og2bgwm130xq3o6uk3h4956la6",
    );
    expect(mapped.values.imagePullSecretName).toBe(
      "aione-ins-og2bgwm130xq3o6uk3h4956la6-image",
    );
    expect(mapped.values.codeRepositorySecretName).toBe(
      "aione-ins-og2bgwm130xq3o6uk3h4956la6-code",
    );
    expect(mapped.values.codeRepositories?.[0]).toMatchObject({
      id: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
      repoUrl: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
      branch: "master",
      mountPath: "/data/js-sample",
    });
    expect(mapped.values.codeRepositories?.[0]).not.toHaveProperty("token");
    expect(mapped.codeRepositoriesWithTokens[0].token).toBe("repo-token");
    expect(mapped.values.cloudStorageMounts?.[0]).toMatchObject({
      cloudStorageId: "stg-2i63j4q0z319cb63mw90qnt2mt",
      pvcName: "ins-og2bgwm130xq3o6uk3h4956la6-stg-2i63j4q0z319cb63mw90qnt2mt",
      storageClass: "bj1-ebs",
      size: "2Gi",
      mountPath: "/data/mystore2",
    });
    expect(mapped.values.gpuNodeLabelKey).toBe("nvidia.com/gpu.present");
  });

  it("uses OWN image fields and the default authorized key when provided", () => {
    const mapped = buildAioneInstanceValues({
      payload: {
        ...basePayload,
        imageType: "OWN",
        image: "docker.fzyun.io/pytorch/pytorch:1.13.1",
        imageKey: "custom-user",
        imageSecret: "custom-secret",
      },
      nodePort: 31010,
      codeServerNodePort: 31011,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-rsa BBBB user@example",
    });

    expect(mapped.values.image).toBe("docker.fzyun.io/pytorch/pytorch:1.13.1");
    expect(mapped.registryCredentials).toMatchObject({
      username: "custom-user",
      password: "custom-secret",
      image: "docker.fzyun.io/pytorch/pytorch:1.13.1",
    });
    expect(mapped.values.authorizedKey).toBe("ssh-rsa BBBB user@example");
  });

  it("rejects payloads without any SSH public key source", () => {
    expect(() =>
      buildAioneInstanceValues({
        payload: { ...basePayload },
        nodePort: 31000,
        codeServerNodePort: 31001,
        internalOrg: "aione",
        defaultStorageClass: "bj1-ebs",
        defaultAuthorizedKey: "",
      }),
    ).toThrow("authorizedKey is required");
  });

  it("accepts bearer and x-api-key credentials", () => {
    expect(
      authenticateAioneRequest(
        new Headers({ authorization: "Bearer key-1" }),
        "key-1,key-2",
      ),
    ).toBe(true);
    expect(
      authenticateAioneRequest(new Headers({ "x-api-key": "key-2" }), [
        "key-1",
        "key-2",
      ]),
    ).toBe(true);
    expect(
      authenticateAioneRequest(new Headers({ authorization: "Bearer bad" }), [
        "key-1",
      ]),
    ).toBe(false);
  });

  it("builds docker registry auth without exposing raw credentials in labels", () => {
    const encoded = buildDockerConfigJson({
      image: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
      username: "gonglijie",
      password: "Founder123",
    });
    const parsed = JSON.parse(encoded);

    expect(Object.keys(parsed.auths)).toEqual(["docker.fzyun.io"]);
    expect(parsed.auths["docker.fzyun.io"].username).toBe("gonglijie");
    expect(parsed.auths["docker.fzyun.io"].password).toBe("Founder123");
  });

  it("builds cleanup labels and bounded secret names", () => {
    expect(
      buildWorkspaceLabels({
        org: "aione",
        project: "aione",
        domain: "development",
        runName: "ins-og2bgwm130xq3o6uk3h4956la6",
      }),
    ).toMatchObject({
      "flyte.org/org": "aione",
      "flyte.org/project": "aione",
      "flyte.org/domain": "development",
      "flyte.org/run-name": "ins-og2bgwm130xq3o6uk3h4956la6",
    });
    expect(
      buildExternalSecretName(
        "aione",
        "this-is-a-very-long-instance-id-that-needs-to-be-truncated",
        "image",
      ).length,
    ).toBeLessThanOrEqual(63);
  });

  it("builds external SSH and code-server access information", () => {
    expect(
      buildAioneInstanceAccessInfo({
        runName: "ins-5ud29xk04tmc6e4ufe8083dvn0",
        sourceName: "开发实例一",
        sshUser: "dev",
        nodePort: 31004,
        codeServerNodePort: 31005,
        cpu: "2",
        memory: "4Gi",
        gpuCount: 0,
        workspaceSize: "20Gi",
        publicScheme: "http",
        publicHost: "172.19.65.230",
      }),
    ).toEqual({
      id: "ins-5ud29xk04tmc6e4ufe8083dvn0",
      name: "开发实例一",
      status: "CREATED",
      ssh: {
        user: "dev",
        host: "172.19.65.230",
        port: 31004,
        command: "ssh -p 31004 dev@172.19.65.230",
      },
      codeServer: {
        host: "172.19.65.230",
        port: 31005,
        url: "http://172.19.65.230:31005",
        workspaceUrl: "http://172.19.65.230:31005/?folder=/workspace",
      },
      resources: {
        cpu: "2",
        memory: "4Gi",
        gpu: 0,
        workspaceSize: "20Gi",
      },
    });
  });

  it("defaults external access URLs to the deployed NodePort host", () => {
    const access = buildAioneInstanceAccessInfo({
      runName: "ins-default",
      sourceName: "",
      sshUser: "dev",
      nodePort: 31004,
      codeServerNodePort: 31005,
      cpu: "2",
      memory: "4Gi",
      gpuCount: 0,
      workspaceSize: "20Gi",
    });

    expect(access.codeServer.url).toBe("http://172.19.65.230:31005");
    expect(access.codeServer.workspaceUrl).toBe(
      "http://172.19.65.230:31005/?folder=/workspace",
    );
  });

  it("wraps successful create results in the external API response shape", () => {
    const info = buildAioneInstanceAccessInfo({
      runName: "ins-2024ad6h4e4x036u9u5j31ec89",
      sourceName: "实例2",
      sshUser: "dev",
      nodePort: 31006,
      codeServerNodePort: 31007,
      cpu: "2",
      memory: "4Gi",
      gpuCount: 0,
      workspaceSize: "20Gi",
      publicScheme: "http",
      publicHost: "172.19.65.230",
    });

    expect(
      buildAioneCreateInstanceResponse({
        internalOrg: "aione",
        project: "aione",
        domain: "development",
        runName: "ins-2024ad6h4e4x036u9u5j31ec89",
        sourceOrg: "",
        sourceInstanceId: "ins-2024ad6h4e4x036u9u5j31ec89",
        info,
      }),
    ).toEqual({
      status: 200,
      data: {
        run: {
          org: "aione",
          project: "aione",
          domain: "development",
          name: "ins-2024ad6h4e4x036u9u5j31ec89",
        },
        source: {
          org: "",
          id: "ins-2024ad6h4e4x036u9u5j31ec89",
        },
        info,
      },
    });
  });
});
