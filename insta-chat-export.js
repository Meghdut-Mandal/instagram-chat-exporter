/* Browser console script to download Instagram DMs.
Intercepts live GraphQL calls to capture details, paginates messages, and exports JSON.
*/

(async function () {
  const MESSAGES_PER_PAGE = 20;
  const DAYS = 30;

  // ── Step 1: Intercept the next Instagram GraphQL call ──────────────────────

  const originalFetch = window.fetch.bind(window);
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  let capturedBodyParams = null;
  let capturedHeaders = null;
  let capturedThreadId = null;
  let capturedDocId = null;

  function tryCapture(bodyStr, headersObj) {
    if (capturedBodyParams) return;
    try {
      const params = new URLSearchParams(bodyStr);
      const variables = JSON.parse(params.get("variables") || "{}");
      if (!variables.id) return;

      capturedThreadId = variables.id;
      capturedDocId = params.get("doc_id") || "";
      capturedBodyParams = Object.fromEntries(params.entries());
      capturedHeaders = headersObj;
      console.log(
        `%c Details captured! Thread ID: ${capturedThreadId}, doc_id: ${capturedDocId}`,
        "color: green; font-weight: bold",
      );
    } catch (_) {}
  }

  // Intercept fetch
  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : (input?.url ?? "");
    if (url.includes("/api/graphql")) {
      const body =
        init.body instanceof URLSearchParams
          ? init.body.toString()
          : typeof init.body === "string"
            ? init.body
            : "";
      const hdrs = init.headers
        ? init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : Array.isArray(init.headers)
            ? Object.fromEntries(init.headers)
            : init.headers
        : {};
      tryCapture(body, hdrs);
    }
    return originalFetch(input, init);
  };

  // Intercept XHR
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._igUrl = url;
    this._igHeaders = {};
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._igHeaders) this._igHeaders[name.toLowerCase()] = value;
    return originalXHRSetHeader.apply(this, [name, value]);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (
      this._igUrl &&
      this._igUrl.includes("/api/graphql") &&
      typeof body === "string"
    ) {
      tryCapture(body, this._igHeaders || {});
    }
    return originalXHRSend.apply(this, [body]);
  };

  console.log(
    "%c📡 Interceptors active — scroll in a DM thread to trigger a GraphQL request...",
    "color: blue; font-weight: bold",
  );

  // Wait until credentials are captured (poll every 500 ms, timeout 60 s)
  await new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (capturedBodyParams && capturedThreadId) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - start > 60_000) {
        clearInterval(iv);
        reject(new Error("Timed out waiting for a GraphQL request."));
      }
    }, 500);
  });

  // Restore originals so page behaviour is unchanged after capture
  window.fetch = originalFetch;
  XMLHttpRequest.prototype.open = originalXHROpen;
  XMLHttpRequest.prototype.send = originalXHRSend;
  XMLHttpRequest.prototype.setRequestHeader = originalXHRSetHeader;

  // ── Step 2: Paginate messages ──────────────────────────────────────────────

  const cutoffMs = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  console.log(`Fetching last ${DAYS} days of messages...`);

  async function fetchMessagePage(threadId, afterCursor) {
    const variables = {
      after: afterCursor,
      before: null,
      first: MESSAGES_PER_PAGE,
      last: null,
      newer_than_message_id: null,
      older_than_message_id: null,
      id: threadId,
      __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:
        MESSAGES_PER_PAGE,
      __relay_internal__pv__IGDEnableOffMsysPinnedMessagesQErelayprovider: false,
    };

    const body = new URLSearchParams({
      ...capturedBodyParams,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "IGDMessageListOffMsysQuery",
      variables: JSON.stringify(variables),
    });

    const text = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      originalXHROpen.call(
        xhr,
        "POST",
        "https://www.instagram.com/api/graphql",
        true,
      );
      const headers = {
        "content-type": "application/x-www-form-urlencoded",
        ...capturedHeaders,
        "x-fb-friendly-name": "IGDMessageListOffMsysQuery",
      };
      for (const [name, value] of Object.entries(headers)) {
        originalXHRSetHeader.call(xhr, name, value);
      }
      xhr.withCredentials = true;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else {
          reject(
            new Error(`HTTP ${xhr.status}: ${xhr.responseText.slice(0, 500)}`),
          );
        }
      };
      xhr.onerror = () => reject(new Error("XHR network error"));
      originalXHRSend.call(xhr, body.toString());
    });
    const jsonText = text.startsWith("for (;;);")
      ? text.slice("for (;;);".length)
      : text;
    const data = JSON.parse(jsonText);

    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    const slideMessages =
      data?.data?.fetch__SlideThread?.as_ig_direct_thread?.slide_messages;

    if (!slideMessages) {
      throw new Error("Could not find slide_messages in response");
    }

    const messages = slideMessages.edges.map((edge) => {
      const node = edge.node;
      return {
        message_id: node.message_id,
        sender_name: node.sender?.name ?? "Unknown",
        sender_username: node.sender?.user_dict?.username ?? "unknown",
        sender_fbid: node.sender_fbid,
        text: node.text_body ?? node.content?.text_body ?? "",
        timestamp_ms: parseInt(node.timestamp_ms, 10),
        timestamp_iso: new Date(parseInt(node.timestamp_ms, 10)).toISOString(),
        content_type: node.content_type,
        reactions: node.reactions ?? [],
        replied_to_message_id: node.replied_to_message_id ?? null,
      };
    });

    return {
      messages,
      nextCursor: slideMessages.page_info?.end_cursor ?? null,
      hasNextPage: slideMessages.page_info?.has_next_page ?? false,
    };
  }

  const allMessages = [];
  let cursor = null;
  let page = 0;
  let reachedCutoff = false;

  while (!reachedCutoff) {
    page++;

    let result;
    try {
      result = await fetchMessagePage(capturedThreadId, cursor);
    } catch (err) {
      console.error(
        `%c❌ Failed on page ${page}: ${err.message}`,
        "color: red; font-weight: bold",
      );
      throw err;
    }

    const { messages, nextCursor, hasNextPage } = result;

    for (const msg of messages) {
      if (msg.timestamp_ms < cutoffMs) {
        reachedCutoff = true;
        break;
      }
      allMessages.push(msg);
    }

    const lastTextMsg = [...allMessages]
      .reverse()
      .find((m) => m.content_type === "TEXT");
    const preview = lastTextMsg
      ? `"${lastTextMsg.text.slice(0, 60)}"`
      : "(no text)";
    console.log(
      `Fetched messages count: ${allMessages.length} .. Last message ${preview}`,
    );

    if (!hasNextPage || !nextCursor) break;
    cursor = nextCursor;

    await new Promise((r) => setTimeout(r, 300));
  }

  allMessages.sort((a, b) => a.timestamp_ms - b.timestamp_ms);

  // ── Step 3: Download as JSON ───────────────────────────────────────────────

  const output = {
    exported_at: new Date().toISOString(),
    thread_id: capturedThreadId,
    days_fetched: DAYS,
    message_count: allMessages.length,
    messages: allMessages,
  };

  const blob = new Blob([JSON.stringify(output, null, 2)], {
    type: "application/json",
  });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = `instagram_conversation_${capturedThreadId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);

  console.log(
    `%c✅ Done! ${allMessages.length} messages saved.`,
    "color: green; font-weight: bold",
  );

  if (allMessages.length > 0) {
    const first = allMessages[0];
    const last = allMessages[allMessages.length - 1];
    console.log(`  Range: ${first.timestamp_iso} → ${last.timestamp_iso}`);
    const participants = [
      ...new Set(
        allMessages.map((m) => `${m.sender_name} (@${m.sender_username})`),
      ),
    ];
    console.log(`  Participants: ${participants.join(", ")}`);
  }
})().catch((err) => {
  console.error(
    `%c❌ Export failed: ${err.message}`,
    "color: red; font-weight: bold; font-size: 14px",
  );
});
