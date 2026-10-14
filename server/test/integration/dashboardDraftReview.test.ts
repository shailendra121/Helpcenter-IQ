import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import {
  DraftArticleNotFoundError,
  InvalidStatusTransitionError,
  RejectionReasonRequiredError,
  ApprovedDraftModificationError,
} from "../../src/db/models/draftArticles.js";

const {
  mockListDraftArticles,
  mockGetDraftArticleById,
  mockGetDraftArticleForGap,
  mockSaveReviewerEdits,
  mockTransitionDraftStatus,
  mockGenerateDraftForGap,
} = vi.hoisted(() => ({
  mockListDraftArticles: vi.fn(),
  mockGetDraftArticleById: vi.fn(),
  mockGetDraftArticleForGap: vi.fn(),
  mockSaveReviewerEdits: vi.fn(),
  mockTransitionDraftStatus: vi.fn(),
  mockGenerateDraftForGap: vi.fn(),
}));

vi.mock(
  "../../src/db/models/draftArticles.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/db/models/draftArticles.js")
      >();

    return {
      ...actual,
      listDraftArticles: mockListDraftArticles,
      getDraftArticleById: mockGetDraftArticleById,
      getDraftArticleForGap: mockGetDraftArticleForGap,
      saveReviewerEdits: mockSaveReviewerEdits,
      transitionDraftStatus: mockTransitionDraftStatus,
    };
  },
);
vi.mock(
  "../../src/drafts/runDraftGeneration.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/drafts/runDraftGeneration.js")
      >();

    return {
      ...actual,
      generateDraftForGap: mockGenerateDraftForGap,
    };
  },
);
import app from "../../src/app.js";
import { createZafSessionToken } from "../../src/auth/zafSession.js";

describe("HCIQ-16 dashboard draft review API", () => {
  beforeEach(() => {
  process.env.ZAF_SESSION_SECRET =
    "test-secret-for-hciq-dashboard-auth-123456";

  process.env.APP_ORIGIN =
    "https://helpcenteriq.test";

  vi.clearAllMocks();
});

  it("rejects anonymous draft list access", async () => {
    const response = await request(app).get(
      "/api/dashboard/drafts",
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toBe(
      "ZAF-authenticated session required",
    );

    expect(mockListDraftArticles).not.toHaveBeenCalled();
  });

  it("lists drafts for the authenticated Zendesk account", async () => {
    mockListDraftArticles.mockResolvedValueOnce([
      {
        id: 500,
        knowledge_gap_id: 10,
        topic_summary: "Reset password",
        suggested_title: "How to reset your password",
        reviewer_suggested_title:
          "Reset your account password",
        review_status: "in_review",
        created_at: new Date(
          "2026-09-24T06:00:00.000Z",
        ),
        reviewer_edited_at: new Date(
          "2026-09-24T06:30:00.000Z",
        ),
        status_updated_at: new Date(
          "2026-09-24T06:35:00.000Z",
        ),
      },
    ]);

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/drafts")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(200);

    expect(mockListDraftArticles).toHaveBeenCalledWith(1);

    expect(response.body.drafts).toHaveLength(1);

    expect(response.body.drafts[0]).toMatchObject({
      id: 500,
      gap_id: 10,
      topic: "Reset password",
      title: "Reset your account password",
      ai_title: "How to reset your password",
      status: "in_review",
    });
  });

it("returns AI original and reviewer revision for one draft", async () => {
  mockGetDraftArticleById.mockResolvedValueOnce({
    id: 500,
    knowledge_gap_id: 10,
    zendesk_account_id: 1,

    suggested_title: "AI title",
    problem_summary: "AI problem",
    step_by_step_resolution: "AI steps",
    faq_json: [
      {
        question: "AI question?",
        answer: "AI answer",
      },
    ],
    related_keywords: ["password", "reset"],
    internal_reviewer_notes: "AI reviewer notes",

    reviewer_suggested_title: "Human title",
    reviewer_problem_summary: "Human problem",
    reviewer_step_by_step_resolution: "Human steps",
    reviewer_faq_json: [
      {
        question: "Human question?",
        answer: "Human answer",
      },
    ],
    reviewer_related_keywords: ["password", "account"],
    reviewer_internal_notes: "Human notes",

    rejection_reason: null,
    reviewer_edited_at: new Date(
      "2026-09-24T06:30:00.000Z"
    ),
    status_updated_at: new Date(
      "2026-09-24T06:35:00.000Z"
    ),

    review_status: "in_review",
    created_at: new Date(
      "2026-09-24T06:00:00.000Z"
    ),
  });

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous"
  );

  const response = await request(app)
    .get("/api/dashboard/drafts/500")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`
    );

  expect(response.status).toBe(200);

  expect(mockGetDraftArticleById).toHaveBeenCalledWith(
    500,
    1
  );

  expect(response.body.ai_original).toEqual({
    suggested_title: "AI title",
    problem_summary: "AI problem",
    step_by_step_resolution: "AI steps",
    faq: [
      {
        question: "AI question?",
        answer: "AI answer",
      },
    ],
    related_keywords: ["password", "reset"],
    internal_reviewer_notes: "AI reviewer notes",
  });

  expect(response.body.reviewer_revision).toEqual({
    suggested_title: "Human title",
    problem_summary: "Human problem",
    step_by_step_resolution: "Human steps",
    faq: [
      {
        question: "Human question?",
        answer: "Human answer",
      },
    ],
    related_keywords: ["password", "account"],
    internal_reviewer_notes: "Human notes",
  });

  // Drafts have no version history.
  expect(response.body).not.toHaveProperty("version");
  expect(response.body).not.toHaveProperty("versions");
});  
      
it("rejects a non-integer draft id", async () => {
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/drafts/abc")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "Draft id must be an integer",
    );

    expect(
      mockGetDraftArticleById,
    ).not.toHaveBeenCalled();
  });

  it("returns 404 when the draft does not exist for the authenticated account", async () => {
    mockGetDraftArticleById.mockResolvedValueOnce(null);

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/drafts/999")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(404);
    expect(response.body.error).toBe(
      "Draft article 999 not found",
    );

    expect(mockGetDraftArticleById).toHaveBeenCalledWith(
      999,
      1,
    );
  });

  it("returns 500 when draft listing fails unexpectedly", async () => {
    mockListDraftArticles.mockRejectedValueOnce(
      new Error("Database unavailable"),
    );

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/drafts")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(500);
    expect(response.body.error).toBe(
      "Failed to load drafts",
    );
  });

  it("returns 500 when draft detail loading fails unexpectedly", async () => {
    mockGetDraftArticleById.mockRejectedValueOnce(
      new Error("Database unavailable"),
    );

    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .get("/api/dashboard/drafts/500")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      );

    expect(response.status).toBe(500);
    expect(response.body.error).toBe(
      "Failed to load draft",
    );
  });
  it("rejects reviewer edits when Origin is missing", async () => {
  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .put("/api/dashboard/drafts/500")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .send({
      suggested_title: "Edited title",
      problem_summary: "Edited problem",
      step_by_step_resolution: "Edited steps",
      faq: [],
      related_keywords: [],
      internal_reviewer_notes: "Reviewed",
    });

  expect(response.status).toBe(403);
  expect(response.body.error).toBe(
    "Trusted request origin required",
  );

  expect(mockSaveReviewerEdits).not.toHaveBeenCalled();
});

it("rejects malformed reviewer edit content", async () => {
  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .put("/api/dashboard/drafts/500")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .set("Origin", "https://helpcenteriq.test")
    .send({
      suggested_title: "Edited title",
      problem_summary: "Edited problem",
      step_by_step_resolution: "Edited steps",
      faq: [
        {
          question: "Question without answer",
        },
      ],
      related_keywords: ["password"],
      internal_reviewer_notes: "Reviewed",
    });

  expect(response.status).toBe(400);
  expect(response.body.error).toBe(
    "faq must be an array of question/answer objects",
  );

  expect(mockSaveReviewerEdits).not.toHaveBeenCalled();
});
 it.each(["", "   "])(
  "rejects blank reviewer title %j",
  async (invalidTitle) => {
    const sessionToken = createZafSessionToken(
      1,
      "d3v-astonous",
    );

    const response = await request(app)
      .put("/api/dashboard/drafts/500")
      .set(
        "Cookie",
        `hciq_zaf_session=${sessionToken}`,
      )
      .set("Origin", "https://helpcenteriq.test")
      .send({
        suggested_title: invalidTitle,
        problem_summary: "Valid problem summary",
        step_by_step_resolution: "Valid resolution",
        faq: [],
        related_keywords: ["password"],
        internal_reviewer_notes: "Reviewed",
      });

    expect(response.status).toBe(400);

    expect(response.body.error).toBe(
      "Article title is required",
    );

    expect(
      mockSaveReviewerEdits,
    ).not.toHaveBeenCalled();
  },
);
it("saves reviewer edits separately for the authenticated account", async () => {
  mockSaveReviewerEdits.mockResolvedValueOnce({
    id: 500,
    knowledge_gap_id: 10,
    zendesk_account_id: 1,

    suggested_title: "Original AI title",
    problem_summary: "Original AI problem",
    step_by_step_resolution: "Original AI steps",
    faq_json: [],
    related_keywords: ["ai"],
    internal_reviewer_notes: "Original AI notes",

    reviewer_suggested_title: "Human title",
    reviewer_problem_summary: "Human problem",
    reviewer_step_by_step_resolution: "Human steps",
    reviewer_faq_json: [
      {
        question: "Can I reset it?",
        answer: "Yes.",
      },
    ],
    reviewer_related_keywords: [
      "password",
      "account",
    ],
    reviewer_internal_notes: "Human notes",

    rejection_reason: null,
    reviewer_edited_at: new Date(
      "2026-09-24T07:00:00.000Z",
    ),
    status_updated_at: null,

    review_status: "draft",
    created_at: new Date(
      "2026-09-24T06:00:00.000Z",
    ),
  });

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .put("/api/dashboard/drafts/500")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .set("Origin", "https://helpcenteriq.test")
    .send({
      suggested_title: "Human title",
      problem_summary: "Human problem",
      step_by_step_resolution: "Human steps",
      faq: [
        {
          question: "Can I reset it?",
          answer: "Yes.",
        },
      ],
      related_keywords: [
        "password",
        "account",
      ],
      internal_reviewer_notes: "Human notes",
    });

  expect(response.status).toBe(200);

  expect(mockSaveReviewerEdits).toHaveBeenCalledWith(
    500,
    1,
    {
      suggestedTitle: "Human title",
      problemSummary: "Human problem",
      stepByStepResolution: "Human steps",
      faq: [
        {
          question: "Can I reset it?",
          answer: "Yes.",
        },
      ],
      relatedKeywords: [
        "password",
        "account",
      ],
      internalReviewerNotes: "Human notes",
    },
  );

  expect(response.body.reviewer_revision).toEqual({
    suggested_title: "Human title",
    problem_summary: "Human problem",
    step_by_step_resolution: "Human steps",
    faq: [
      {
        question: "Can I reset it?",
        answer: "Yes.",
      },
    ],
    related_keywords: [
      "password",
      "account",
    ],
    internal_reviewer_notes: "Human notes",
  });

  // The edit response should expose the reviewer revision,
  // not silently replace it with AI content.
  expect(
    response.body.reviewer_revision.suggested_title,
  ).not.toBe("Original AI title");
});

it("returns 409 when editing an approved draft", async () => {
  mockSaveReviewerEdits.mockRejectedValueOnce(
    new ApprovedDraftModificationError()
  );

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous"
  );

  const response = await request(app)
    .put("/api/dashboard/drafts/500")
    .set("Cookie", `hciq_zaf_session=${sessionToken}`)
    .set("Origin", "https://helpcenteriq.test")
    .send({
      suggested_title: "Modified approved title",
      problem_summary: "Modified summary",
      step_by_step_resolution: "Modified steps",
      faq: [],
      related_keywords: [],
      internal_reviewer_notes: "Modified notes",
    });

  expect(response.status).toBe(409);

  expect(response.body.error).toBe(
    "Approved drafts cannot be edited or regenerated."
  );

  expect(mockSaveReviewerEdits).toHaveBeenCalledWith(
    500,
    1,
    expect.any(Object)
  );
});

it("returns 404 when saving edits to a draft outside the authenticated account", async () => {
  mockSaveReviewerEdits.mockResolvedValueOnce(null);

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .put("/api/dashboard/drafts/999")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .set("Origin", "https://helpcenteriq.test")
    .send({
      suggested_title: "Edited title",
      problem_summary: "Edited problem",
      step_by_step_resolution: "Edited steps",
      faq: [],
      related_keywords: [],
      internal_reviewer_notes: "Reviewed",
    });

  expect(response.status).toBe(404);
  expect(response.body.error).toBe(
    "Draft article 999 not found",
  );

  expect(mockSaveReviewerEdits).toHaveBeenCalledWith(
    999,
    1,
    expect.any(Object),
  );
});
it("moves a draft into review for the authenticated account", async () => {
  mockTransitionDraftStatus.mockResolvedValueOnce(undefined);

  const sessionToken = createZafSessionToken(1, "d3v-astonous");

  const response = await request(app)
    .post("/api/dashboard/drafts/500/status")
    .set("Cookie", `hciq_zaf_session=${sessionToken}`)
    .set("Origin", "https://helpcenteriq.test")
    .send({
      status: "in_review",
    });

  expect(response.status).toBe(200);

  expect(mockTransitionDraftStatus).toHaveBeenCalledWith(
    500,
    1,
    "in_review",
    undefined,
  );

  expect(response.body).toEqual({
    id: 500,
    status: "in_review",
    rejection_reason: null,
  });
});

it("approves a draft that is in review", async () => {
  mockTransitionDraftStatus.mockResolvedValueOnce(undefined);

  const sessionToken = createZafSessionToken(1, "d3v-astonous");

  const response = await request(app)
    .post("/api/dashboard/drafts/500/status")
    .set("Cookie", `hciq_zaf_session=${sessionToken}`)
    .set("Origin", "https://helpcenteriq.test")
    .send({
      status: "approved",
    });

  expect(response.status).toBe(200);

  expect(mockTransitionDraftStatus).toHaveBeenCalledWith(
    500,
    1,
    "approved",
    undefined,
  );
});

it("rejects a draft with a required rejection reason", async () => {
  mockTransitionDraftStatus.mockResolvedValueOnce(undefined);

  const sessionToken = createZafSessionToken(1, "d3v-astonous");

  const response = await request(app)
    .post("/api/dashboard/drafts/500/status")
    .set("Cookie", `hciq_zaf_session=${sessionToken}`)
    .set("Origin", "https://helpcenteriq.test")
    .send({
      status: "rejected",
      rejection_reason: "Resolution steps need more detail.",
    });

  expect(response.status).toBe(200);

  expect(mockTransitionDraftStatus).toHaveBeenCalledWith(
    500,
    1,
    "rejected",
    "Resolution steps need more detail.",
  );

  expect(response.body).toEqual({
    id: 500,
    status: "rejected",
    rejection_reason: "Resolution steps need more detail.",
  });
});

it("rejects an unsupported review status", async () => {
  const sessionToken = createZafSessionToken(1, "d3v-astonous");

  const response = await request(app)
    .post("/api/dashboard/drafts/500/status")
    .set("Cookie", `hciq_zaf_session=${sessionToken}`)
    .set("Origin", "https://helpcenteriq.test")
    .send({
      status: "published",
    });

  expect(response.status).toBe(400);
  expect(response.body.error).toBe(
    "status must be one of: draft, in_review, approved, rejected",
  );

  expect(mockTransitionDraftStatus).not.toHaveBeenCalled();
});

it("rejects status mutation when Origin is missing", async () => {
  const sessionToken = createZafSessionToken(1, "d3v-astonous");

  const response = await request(app)
    .post("/api/dashboard/drafts/500/status")
    .set("Cookie", `hciq_zaf_session=${sessionToken}`)
    .send({
      status: "in_review",
    });

  expect(response.status).toBe(403);
  expect(response.body.error).toBe(
    "Trusted request origin required",
  );

  expect(mockTransitionDraftStatus).not.toHaveBeenCalled();
});
it("requires a reason when rejecting a draft", async () => {
  mockTransitionDraftStatus.mockRejectedValueOnce(
    new RejectionReasonRequiredError(),
  );

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .post("/api/dashboard/drafts/500/status")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .set("Origin", "https://helpcenteriq.test")
    .send({
      status: "rejected",
    });

  expect(response.status).toBe(400);
  expect(response.body.error).toBe(
    "A rejection reason is required when rejecting a draft article",
  );

  expect(mockTransitionDraftStatus).toHaveBeenCalledWith(
    500,
    1,
    "rejected",
    undefined,
  );
});

it("returns 409 for an invalid draft status transition", async () => {
  mockTransitionDraftStatus.mockRejectedValueOnce(
    new InvalidStatusTransitionError(
      "approved",
      "rejected",
    ),
  );

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .post("/api/dashboard/drafts/500/status")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .set("Origin", "https://helpcenteriq.test")
    .send({
      status: "rejected",
      rejection_reason: "Needs changes",
    });

  expect(response.status).toBe(409);

  expect(response.body.error).toContain(
    "Cannot transition draft article",
  );
});

it("returns 404 when changing status of a draft outside the authenticated account", async () => {
  mockTransitionDraftStatus.mockRejectedValueOnce(
    new DraftArticleNotFoundError(999),
  );

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .post("/api/dashboard/drafts/999/status")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .set("Origin", "https://helpcenteriq.test")
    .send({
      status: "in_review",
    });

  expect(response.status).toBe(404);
  expect(response.body.error).toBe(
    "No draft article found with id 999",
  );

  expect(mockTransitionDraftStatus).toHaveBeenCalledWith(
    999,
    1,
    "in_review",
    undefined,
  );
});

it("regenerates a draft using its account-scoped knowledge gap", async () => {
  mockGetDraftArticleById.mockResolvedValueOnce({
    id: 500,
    knowledge_gap_id: 10,
    zendesk_account_id: 1,
    suggested_title: "Original AI title",
    problem_summary: "Original problem",
    step_by_step_resolution: "Original steps",
    faq_json: [],
    related_keywords: [],
    internal_reviewer_notes: null,
    reviewer_suggested_title: null,
    reviewer_problem_summary: null,
    reviewer_step_by_step_resolution: null,
    reviewer_faq_json: null,
    reviewer_related_keywords: null,
    reviewer_internal_notes: null,
    rejection_reason: null,
    reviewer_edited_at: null,
    status_updated_at: null,
    review_status: "draft",
    created_at: new Date("2026-09-24T06:00:00.000Z"),
  });

  mockGenerateDraftForGap.mockResolvedValueOnce({
    draftId: 500,
  });

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .post("/api/dashboard/drafts/500/regenerate")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .set("Origin", "https://helpcenteriq.test")
    .send();

  expect(response.status).toBe(200);

  expect(mockGetDraftArticleById).toHaveBeenCalledWith(
    500,
    1,
  );

  expect(mockGenerateDraftForGap).toHaveBeenCalledWith(
    1,
    10,
  );

  expect(response.body).toEqual({
    draft_id: 500,
    gap_id: 10,
  });
});

it("returns 409 without calling AI when regenerating an approved draft", async () => {
  mockGetDraftArticleById.mockResolvedValueOnce({
    id: 500,
    knowledge_gap_id: 10,
    zendesk_account_id: 1,
    review_status: "approved",
  });

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous"
  );

  const response = await request(app)
    .post("/api/dashboard/drafts/500/regenerate")
    .set("Cookie", `hciq_zaf_session=${sessionToken}`)
    .set("Origin", "https://helpcenteriq.test")
    .send();

  expect(response.status).toBe(409);

  expect(response.body.error).toBe(
    "Approved drafts cannot be edited or regenerated."
  );

  expect(mockGetDraftArticleById).toHaveBeenCalledWith(
    500,
    1
  );

  expect(mockGenerateDraftForGap).not.toHaveBeenCalled();
});

it("does not regenerate a draft outside the authenticated account", async () => {
  mockGetDraftArticleById.mockResolvedValueOnce(null);

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .post("/api/dashboard/drafts/999/regenerate")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .set("Origin", "https://helpcenteriq.test")
    .send();

  expect(response.status).toBe(404);
  expect(response.body.error).toBe(
    "Draft article 999 not found",
  );

  expect(mockGetDraftArticleById).toHaveBeenCalledWith(
    999,
    1,
  );

  expect(mockGenerateDraftForGap).not.toHaveBeenCalled();
});

it("rejects draft regeneration when Origin is missing", async () => {
  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous",
  );

  const response = await request(app)
    .post("/api/dashboard/drafts/500/regenerate")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`,
    )
    .send();

  expect(response.status).toBe(403);
  expect(response.body.error).toBe(
    "Trusted request origin required",
  );

  expect(mockGetDraftArticleById).not.toHaveBeenCalled();
  expect(mockGenerateDraftForGap).not.toHaveBeenCalled();
});
it("returns the existing draft instead of generating another draft for the same gap", async () => {
  mockGetDraftArticleForGap.mockResolvedValueOnce({
    id: 500,
    knowledge_gap_id: 10,
    zendesk_account_id: 1,
  });

  const sessionToken = createZafSessionToken(
    1,
    "d3v-astonous"
  );

  const response = await request(app)
    .post("/api/dashboard/gaps/10/drafts")
    .set(
      "Cookie",
      `hciq_zaf_session=${sessionToken}`
    )
    .set("Origin", "https://helpcenteriq.test")
    .send();

  expect(response.status).toBe(200);

  expect(mockGetDraftArticleForGap).toHaveBeenCalledWith(
    10,
    1
  );

  expect(mockGenerateDraftForGap).not.toHaveBeenCalled();

  expect(response.body).toEqual({
    id: 500,
    gap_id: 10,
  });
});
});