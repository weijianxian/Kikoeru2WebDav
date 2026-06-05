import assert from "node:assert/strict";
import { buildManifest, handleRequest, normalizeDavPath } from "../src/worker.js";

const remoteBase =
  "https://raw.kiko-play-niptan.one/media/stream/daily/2026-05-30/RJ01557615/GKSD049/01%EF%BC%9A%E3%80%90mp3%E3%80%91%E6%AD%A3%E7%AF%87";

const env = {
  REMOTE_BASE_URL: remoteBase,
  DAV_TITLE: "raw-kiko",
  VIRTUAL_FILES: JSON.stringify(["07表白.mp3"]),
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

async function test(name, fn) {
  await fn();
  console.log(`ok - ${name}`);
}

await test("normalizes encoded DAV paths", () => {
  assert.equal(normalizeDavPath("/07%E8%A1%A8%E7%99%BD.mp3"), "/07表白.mp3");
});

await test("builds a synthetic directory tree", async () => {
  const manifest = await buildManifest({
    REMOTE_BASE_URL: "https://example.com/root",
    VIRTUAL_FILES: JSON.stringify(["album/track.mp3"]),
  });

  assert.equal(manifest.dirs.has("/"), true);
  assert.equal(manifest.dirs.has("/album"), true);
  assert.equal(manifest.files.get("/album/track.mp3").remoteUrl, "https://example.com/root/album/track.mp3");
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

await test("uses the first URL segment as the asmr track id", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    assert.equal(url, "https://api.asmr-200.com/api/tracks/01489611?v=2");
    return Response.json(asmrTree);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/01489611/", {
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

await test("lists popular works as WebDAV directories", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.asmr-200.com/api/recommender/popular");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("content-type"), "application/json");
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
        headers: { Depth: "1" },
      }),
      { ASMR_CACHE_TTL_SECONDS: "0" },
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

  globalThis.fetch = async (url) => {
    assert.equal(url, "https://api.asmr-200.com/api/tracks/01489611?v=2");
    return Response.json(asmrTree);
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/popular/RJ01489611/", {
        method: "PROPFIND",
        headers: { Depth: "1" },
      }),
      { ASMR_CACHE_TTL_SECONDS: "0" },
    );
    const xml = await response.text();

    assert.equal(response.status, 207);
    assert.match(xml, /<D:href>\/popular\/RJ01489611\/<\/D:href>/);
    assert.match(xml, /\/popular\/RJ01489611\/01_%E6%9C%AC%E7%B7%A8\//);
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
      new Request("https://dav.example/RJ01489611/01_%E6%9C%AC%E7%B7%A8/TR01.wav", {
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

await test("asks for a URL work id when no static source is configured", async () => {
  const response = await handleRequest(new Request("https://dav.example/"));
  const body = await response.text();

  assert.equal(response.status, 400);
  assert.match(body, /01489611/);
});

await test("answers OPTIONS as a DAV endpoint", async () => {
  const response = await handleRequest(new Request("https://dav.example/", { method: "OPTIONS" }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("DAV"), "1");
  assert.match(response.headers.get("Allow"), /PROPFIND/);
});

await test("returns PROPFIND multistatus with encoded hrefs", async () => {
  const response = await handleRequest(
    new Request("https://dav.example/", {
      method: "PROPFIND",
      headers: { Depth: "1" },
    }),
    env,
  );
  const xml = await response.text();

  assert.equal(response.status, 207);
  assert.match(xml, /<D:displayname>07表白\.mp3<\/D:displayname>/);
  assert.match(xml, /\/07%E8%A1%A8%E7%99%BD\.mp3/);
  assert.match(xml, /audio\/mpeg/);
});

await test("proxies GET with Range to the remote resource", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    assert.equal(
      url,
      "https://raw.kiko-play-niptan.one/media/stream/daily/2026-05-30/RJ01557615/GKSD049/01%EF%BC%9A%E3%80%90mp3%E3%80%91%E6%AD%A3%E7%AF%87/07%E8%A1%A8%E7%99%BD.mp3",
    );
    assert.equal(init.method, "GET");
    assert.equal(init.headers.get("range"), "bytes=0-1");

    return new Response("ok", {
      status: 206,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": "2",
        "Content-Range": "bytes 0-1/10",
      },
    });
  };

  try {
    const response = await handleRequest(
      new Request("https://dav.example/07%E8%A1%A8%E7%99%BD.mp3", {
        headers: { Range: "bytes=0-1" },
      }),
      env,
    );

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
    assert.equal(await response.text(), "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
