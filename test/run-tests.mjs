import assert from "node:assert/strict";
import { envWithAsmrAuthorization } from "../src/asmr/auth.js";
import { buildManifest, handleRequest, normalizeDavPath } from "../src/index.js";

const env = {
  DAV_TITLE: "asmr-webdav",
};

const asmrTree = [
  {
    type: "folder",
    title: "01_本編",
    children: [
      {
        type: "audio",
        hash: "1489611/1684795",
        title: "TR01.wav",
        mediaStreamUrl: "https://raw.example/stream/TR01.wav",
        mediaDownloadUrl: "https://raw.example/download/TR01.wav",
        size: 76799540,
      },
    ],
  },
  {
    type: "folder",
    title: "02_高画質イラスト",
    children: [
      {
        type: "image",
        title: "ロゴ無し.png",
        mediaStreamUrl: "https://raw.example/stream/logo.png",
        mediaDownloadUrl: "https://raw.example/download/logo.png",
        size: 4405867,
      },
    ],
  },
];

const smartTree = [
  {
    type: "folder",
    title: "Audio",
    children: [
      {
        type: "audio",
        title: "track.mp3",
        mediaDownloadUrl: "https://raw.example/download/track.mp3",
        size: 1234,
      },
      {
        type: "text",
        title: "notes.txt",
        mediaDownloadUrl: "https://raw.example/download/notes.txt",
        size: 56,
      },
      {
        type: "folder",
        title: "Booklet",
        children: [
          {
            type: "image",
            title: "cover.png",
            mediaDownloadUrl: "https://raw.example/download/cover.png",
            size: 78,
          },
        ],
      },
    ],
  },
  {
    type: "folder",
    title: "Artwork",
    children: [
      {
        type: "image",
        title: "logo.png",
        mediaDownloadUrl: "https://raw.example/download/logo.png",
      },
    ],
  },
  {
    type: "folder",
    title: "WavOnly",
    children: [
      {
        type: "audio",
        title: "track.wav",
        mediaDownloadUrl: "https://raw.example/download/track.wav",
      },
    ],
  },
];

const popularWorks = {
  works: [
    {
      id: "RJ01489611",
      title: "眠りの部屋",
      circle: { name: "kiko circle" },
    },
    {
      source_id: "RJ01557615",
      name: "雨の日の耳かき",
    },
  ],
};

const recommenderUuid = "11111111-2222-3333-4444-555555555555";

async function test(name, fn) {
  await fn();
  console.log(`ok - ${name}`);
}

class MemoryKv {
  constructor() {
    this.values = new Map();
    this.puts = [];
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value, options = {}) {
    this.values.set(key, value);
    this.puts.push({ key, value, options });
  }
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

await test("normalizes encoded DAV paths", () => {
  assert.equal(normalizeDavPath("/07%E8%A1%A8%E7%99%BD.mp3"), "/07表白.mp3");
});

await test("builds a manifest from the asmr track API tree", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.asmr-200.com/api/tracks/01489611?v=2");
    assert.match(init.headers.get("user-agent"), /Chrome\/148/);

    return Response.json(asmrTree);
  };

  try {
    const manifest = await buildManifest({
      ASMR_TRACK_ID: "RJ01489611",
      ASMR_CACHE_TTL_SECONDS: "0",
      ASMR_SMART: "0",
      ASMR_PREFIX_FILE_ID: "false",
    });

    assert.equal(manifest.dirs.has("/01_本編"), true);
    assert.equal(manifest.dirs.has("/02_高画質イラスト"), true);
    assert.equal(
      manifest.files.get("/01_本編/TR01.wav").remoteUrl,
      "https://raw.example/download/TR01.wav",
    );
    assert.equal(manifest.files.get("/01_本編/TR01.wav").size, 76799540);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("smart manifest defaults to mp3 folders and keeps the whole matching folder", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    assert.equal(url, "https://api.asmr-200.com/api/tracks/01489611?v=2");
    return Response.json(smartTree);
  };

  try {
    const manifest = await buildManifest({
      ASMR_TRACK_ID: "01489611",
      ASMR_CACHE_TTL_SECONDS: "0",
    });

    assert.equal(manifest.dirs.has("/Audio"), true);
    assert.equal(manifest.dirs.has("/Audio/Booklet"), true);
    assert.equal(manifest.dirs.has("/Artwork"), false);
    assert.equal(manifest.dirs.has("/WavOnly"), false);
    assert.equal(manifest.files.has("/Audio/RJ01489611 track.mp3"), true);
    assert.equal(manifest.files.has("/Audio/RJ01489611 notes.txt"), true);
    assert.equal(manifest.files.has("/Audio/Booklet/RJ01489611 cover.png"), true);
    assert.equal(manifest.files.has("/WavOnly/RJ01489611 track.wav"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("smart manifest supports ext and prefixId params", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    assert.equal(url, "https://api.asmr-200.com/api/tracks/01489611?v=2");
    return Response.json(smartTree);
  };

  try {
    const wavManifest = await buildManifest(
      {
        ASMR_TRACK_ID: "RJ01489611",
        ASMR_CACHE_TTL_SECONDS: "0",
      },
      new URLSearchParams("ext=wav&prefixId=0"),
    );

    assert.equal(wavManifest.dirs.has("/Audio"), false);
    assert.equal(wavManifest.dirs.has("/WavOnly"), true);
    assert.equal(wavManifest.files.has("/WavOnly/track.wav"), true);

    const fullManifest = await buildManifest(
      {
        ASMR_TRACK_ID: "RJ01489611",
        ASMR_CACHE_TTL_SECONDS: "0",
      },
      new URLSearchParams("smart=0&prefixId=0"),
    );

    assert.equal(fullManifest.dirs.has("/Artwork"), true);
    assert.equal(fullManifest.files.has("/Audio/track.mp3"), true);
    assert.equal(fullManifest.files.has("/WavOnly/track.wav"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("uses the first URL segment as the asmr track id", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    assert.equal(url, "https://api.asmr-200.com/api/tracks/01489611?v=2");
    return Response.json(asmrTree);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/01489611/?ext=wav&prefixId=0", {
        method: "PROPFIND",
        headers: { Depth: "1" },
      }),
      { ASMR_CACHE_TTL_SECONDS: "0" },
    );
    const xml = await response.text();

    assert.equal(response.status, 207);
    assert.match(xml, /<D:href>\/01489611\/<\/D:href>/);
    assert.match(xml, /\/01489611\/01_%E6%9C%AC%E7%B7%A8\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("URL-id works use smart mp3 folders by default", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    assert.equal(url, "https://api.asmr-200.com/api/tracks/01489611?v=2");
    return Response.json(smartTree);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/RJ01489611/", {
        method: "PROPFIND",
        headers: { Depth: "infinity" },
      }),
      { ASMR_CACHE_TTL_SECONDS: "0" },
    );
    const xml = await response.text();

    assert.equal(response.status, 207);
    assert.match(xml, /\/RJ01489611\/Audio\//);
    assert.match(xml, /RJ01489611%20notes\.txt/);
    assert.equal(xml.includes("/RJ01489611/Artwork/"), false);
    assert.equal(xml.includes("/RJ01489611/WavOnly/"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("lists popular works as WebDAV directories", async () => {
  const originalFetch = globalThis.fetch;
  const kv = new MemoryKv();

  globalThis.fetch = async (url, init) => {
    assert.notEqual(url, "https://api.asmr-200.com/api/auth/me");
    assert.equal(url, "https://api.asmr-200.com/api/recommender/popular");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("content-type"), "application/json");
    assert.equal(init.headers.get("authorization"), null);
    assert.deepEqual(JSON.parse(init.body), {
      keyword: " ",
      page: 2,
      pageSize: 3,
      subtitle: 0,
      localSubtitledWorks: [],
      withPlaylistStatus: [],
    });

    return Response.json(popularWorks);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/popular/?page=2&pageSize=3", {
        method: "PROPFIND",
        headers: {
          Authorization: basicAuth("listener", "secret"),
          Depth: "1",
        },
      }),
      {
        ASMR_AUTH_KV: kv,
        ASMR_CACHE_TTL_SECONDS: "0",
      },
    );
    const xml = await response.text();

    assert.equal(response.status, 207);
    assert.match(xml, /<D:href>\/popular\/<\/D:href>/);
    assert.match(xml, /<D:displayname>RJ01489611 眠りの部屋 \(kiko circle\)<\/D:displayname>/);
    assert.match(xml, /<D:href>\/popular\/RJ01489611\/<\/D:href>/);
    assert.match(xml, /<D:href>\/popular\/RJ01557615\/<\/D:href>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("opens a popular work directory through the track API", async () => {
  const originalFetch = globalThis.fetch;
  const kv = new MemoryKv();

  globalThis.fetch = async (url, init = {}) => {
    assert.notEqual(url, "https://api.asmr-200.com/api/auth/me");
    assert.equal(url, "https://api.asmr-200.com/api/tracks/01489611?v=2");
    assert.equal(init.headers.get("authorization"), null);
    return Response.json(asmrTree);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/popular/RJ01489611/?ext=wav&prefixId=0", {
        method: "PROPFIND",
        headers: {
          Authorization: basicAuth("listener", "secret"),
          Depth: "1",
        },
      }),
      {
        ASMR_AUTH_KV: kv,
        ASMR_CACHE_TTL_SECONDS: "0",
      },
    );
    const xml = await response.text();

    assert.equal(response.status, 207);
    assert.match(xml, /<D:href>\/popular\/RJ01489611\/<\/D:href>/);
    assert.match(xml, /\/popular\/RJ01489611\/01_%E6%9C%AC%E7%B7%A8\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("lists recommended works through authenticated asmr recommendations", async () => {
  const originalFetch = globalThis.fetch;
  const kv = new MemoryKv();
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));

    if (url === "https://api.asmr-200.com/api/auth/me") {
      assert.equal(init.method, "POST");
      assert.equal(init.headers.get("authorization"), "null");
      assert.deepEqual(JSON.parse(init.body), {
        name: "listener",
        password: "secret",
      });

      return Response.json({
        user: { loggedIn: true, name: "listener", recommenderUuid },
        token: "recommend-token",
      });
    }

    assert.equal(url, "https://api.asmr-200.com/api/recommender/recommend-for-user");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("authorization"), "Bearer recommend-token");
    assert.deepEqual(JSON.parse(init.body), {
      keyword: " ",
      recommenderUuid,
      page: 2,
      pageSize: 3,
      subtitle: 0,
      localSubtitledWorks: [],
      withPlaylistStatus: [],
    });

    return Response.json(popularWorks);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/recommend/?page=2&pageSize=3", {
        method: "PROPFIND",
        headers: {
          Authorization: basicAuth("listener", "secret"),
          Depth: "1",
        },
      }),
      {
        ASMR_AUTH_KV: kv,
        ASMR_CACHE_TTL_SECONDS: "0",
      },
    );
    const xml = await response.text();

    assert.equal(response.status, 207);
    assert.deepEqual(calls, [
      "https://api.asmr-200.com/api/auth/me",
      "https://api.asmr-200.com/api/recommender/recommend-for-user",
    ]);
    assert.match(xml, /<D:href>\/recommend\/<\/D:href>/);
    assert.match(xml, /<D:href>\/recommend\/RJ01489611\/<\/D:href>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("rejects token-required recommendations without a KV binding", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/recommend/", {
        method: "PROPFIND",
        headers: {
          Authorization: basicAuth("listener", "secret"),
          Depth: "1",
        },
      }),
      {
        ASMR_CACHE_TTL_SECONDS: "0",
      },
    );

    assert.equal(response.status, 500);
    assert.deepEqual(calls, []);
    assert.match(await response.text(), /ASMR_AUTH_KV binding required/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("challenges unauthenticated Basic Auth clients for recommended works", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/recommend/", {
        method: "PROPFIND",
        headers: { Depth: "1" },
      }),
      {
        DAV_TITLE: "asmr-webdav",
      },
    );

    assert.equal(response.status, 401);
    assert.match(response.headers.get("WWW-Authenticate"), /^Basic realm="asmr-webdav"/);
    assert.match(await response.text(), /ASMR authentication required/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("rejects guest Basic Auth for recommended works", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/recommend/", {
        method: "PROPFIND",
        headers: {
          Authorization: basicAuth("guest", "whatever"),
          Depth: "1",
        },
      }),
      {
        ASMR_AUTH_KV: new MemoryKv(),
      },
    );

    assert.equal(response.status, 401);
    assert.match(response.headers.get("WWW-Authenticate"), /^Basic /);
    assert.match(await response.text(), /ASMR authentication required/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("allows guest Basic Auth to browse public track APIs without logging in", async () => {
  const originalFetch = globalThis.fetch;
  const kv = new MemoryKv();

  globalThis.fetch = async (url, init = {}) => {
    assert.notEqual(url, "https://api.asmr-200.com/api/auth/me");
    assert.equal(url, "https://api.asmr-200.com/api/tracks/01489611?v=2");
    assert.equal(init.headers.get("authorization"), null);
    return Response.json(asmrTree);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/01489611/?ext=wav&prefixId=0", {
        method: "PROPFIND",
        headers: {
          Authorization: basicAuth("guest", "whatever"),
          Depth: "1",
        },
      }),
      {
        ASMR_AUTH_KV: kv,
        ASMR_CACHE_TTL_SECONDS: "0",
      },
    );
    const xml = await response.text();

    assert.equal(response.status, 207);
    assert.match(xml, /\/01489611\/01_%E6%9C%AC%E7%B7%A8\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("gets an asmr token from Basic Auth credentials and stores it in KV", async () => {
  const originalFetch = globalThis.fetch;
  const kv = new MemoryKv();
  let loginCalls = 0;

  globalThis.fetch = async (url, init = {}) => {
    if (url === "https://api.asmr-200.com/api/auth/me") {
      loginCalls += 1;
      assert.equal(init.method, "POST");
      assert.equal(init.headers.get("authorization"), "null");
      assert.equal(init.headers.get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(init.body), {
        name: "listener",
        password: "secret",
      });

      return Response.json({
        user: { loggedIn: true, name: "listener", recommenderUuid },
        token: "fresh-token",
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const authorizedEnv = await envWithAsmrAuthorization(
      {
        ASMR_AUTH_KV: kv,
      },
      {
        username: "listener",
        password: "secret",
      },
    );

    assert.equal(authorizedEnv.ASMR_AUTHORIZATION, "Bearer fresh-token");
    assert.equal(authorizedEnv.ASMR_RECOMMENDER_UUID, recommenderUuid);
    assert.equal(loginCalls, 1);
    assert.equal(kv.puts.length, 1);
    assert.equal(JSON.parse(kv.puts[0].value).token, "fresh-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("does not log into asmr with guest credentials", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const authorizedEnv = await envWithAsmrAuthorization(
      {
        ASMR_AUTH_KV: new MemoryKv(),
      },
      {
        username: "guest",
        password: "anything",
        guest: true,
      },
    );

    assert.equal(authorizedEnv.ASMR_AUTHORIZATION, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("validates a cached asmr token before reusing it for authenticated requests", async () => {
  const originalFetch = globalThis.fetch;
  const kv = new MemoryKv();
  let loginCalls = 0;
  let validationCalls = 0;

  globalThis.fetch = async (url, init = {}) => {
    if (url === "https://api.asmr-200.com/api/auth/me" && init.method === "POST") {
      loginCalls += 1;
      return Response.json({
        user: { loggedIn: true, name: "listener" },
        token: "cached-token",
      });
    }

    if (url === "https://api.asmr-200.com/api/auth/me") {
      validationCalls += 1;
      assert.equal(init.method, "GET");
      assert.equal(init.headers.get("authorization"), "Bearer cached-token");
      return Response.json({
        user: { loggedIn: true, name: "listener" },
        auth: true,
        reg: true,
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const envWithKv = {
      ASMR_AUTH_KV: kv,
      ASMR_AUTH_VALIDATE_TTL_SECONDS: "0",
    };
    const credentials = {
      username: "listener",
      password: "secret",
    };

    assert.equal(
      (await envWithAsmrAuthorization(envWithKv, credentials)).ASMR_AUTHORIZATION,
      "Bearer cached-token",
    );
    assert.equal(
      (await envWithAsmrAuthorization(envWithKv, credentials)).ASMR_AUTHORIZATION,
      "Bearer cached-token",
    );
    assert.equal(loginCalls, 1);
    assert.equal(validationCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("proxies dynamic URL-id files to the API-provided remote URL", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).startsWith("https://api.asmr-200.com/")) {
      return Response.json(asmrTree);
    }

    assert.equal(url, "https://raw.example/download/TR01.wav");
    assert.equal(init.headers.get("range"), "bytes=0-3");
    return new Response("data", {
      status: 206,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Range": "bytes 0-3/100",
      },
    });
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/RJ01489611/01_%E6%9C%AC%E7%B7%A8/TR01.wav?ext=wav&prefixId=0", {
        headers: { Range: "bytes=0-3" },
      }),
      { ASMR_CACHE_TTL_SECONDS: "0" },
    );

    assert.equal(response.status, 206);
    assert.deepEqual(calls, [
      "https://api.asmr-200.com/api/tracks/01489611?v=2",
      "https://raw.example/download/TR01.wav",
    ]);
    assert.equal(await response.text(), "data");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("challenges unauthenticated root WebDAV listings", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/", {
        method: "PROPFIND",
        headers: { Depth: "1" },
      }),
    );

    assert.equal(response.status, 401);
    assert.match(response.headers.get("WWW-Authenticate"), /^Basic /);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("adds recommend to the root listing for authenticated users", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/", {
        method: "PROPFIND",
        headers: {
          Authorization: basicAuth("listener", "secret"),
          Depth: "1",
        },
      }),
      {},
    );
    const xml = await response.text();

    assert.equal(response.status, 207);
    assert.match(xml, /<D:href>\/popular\/<\/D:href>/);
    assert.match(xml, /<D:href>\/recommend\/<\/D:href>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("keeps recommend hidden from guest root listings", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/", {
        method: "PROPFIND",
        headers: {
          Authorization: basicAuth("guest", "anything"),
          Depth: "1",
        },
      }),
      {},
    );
    const xml = await response.text();

    assert.equal(response.status, 207);
    assert.match(xml, /<D:href>\/popular\/<\/D:href>/);
    assert.equal(xml.includes("/recommend/"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("answers OPTIONS as a DAV endpoint", async () => {
  const response = await handleRequest(new Request("https://dav.example/", { method: "OPTIONS" }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("DAV"), "1");
  assert.match(response.headers.get("Allow"), /PROPFIND/);
});
