import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useMEData, api } = vi.hoisted(() => ({ useMEData: vi.fn(), api: vi.fn() }));

vi.mock("../../../meApi", () => ({ api }));

/* Shared is mocked so these tests cover only Forms.jsx, not the shared building blocks. */
vi.mock("./Shared", () => ({
  BTN: "btn",
  CARD: "card",
  FIELD: "field",
  useMEData,
  Page: ({ children }) => <main>{children}</main>,
  PageHead: ({ title, subtitle, children }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </header>
  ),
  ErrorBar: ({ error }) => (error ? <div role="alert">{error}</div> : null),
  FrameworkSelect: () => <div data-testid="framework-select" />,
  NoFramework: () => <div data-testid="no-framework" />,
  PeriodTabs: ({ periods, value }) => (
    <div data-testid="period-tabs">{periods.map((p) => (p === value ? `[${p}]` : p)).join(" ")}</div>
  ),
  StatusPill: ({ status }) => <span data-testid="status">{status ?? "none"}</span>,
}));

import MEForms from "./Forms";

const outcome1 = { id: "r1", title: "Outcome 1: Access to education" };
const outcome2 = { id: "r2", title: "Outcome 2: Access to health" };

const ind = (id, name, extra = {}) => ({ id, name, unit: "%", baseline: 10, ...extra });

const defaultRows = () => [
  { ind: ind("i1", "Girls enrolled"), result: outcome1, target: 100, saved: undefined },
  {
    ind: ind("i2", "Teachers trained"),
    result: outcome1,
    target: 50,
    saved: { actual: 20, comment: "On track", status: "submitted" },
  },
  {
    ind: ind("i3", "Schools reached"),
    result: outcome1,
    target: 10,
    saved: { actual: 10, comment: "Done", status: "approved" },
  },
  { ind: ind("i4", "Indicator without target"), result: outcome1, target: undefined, saved: undefined },
  { ind: ind("i5", "Clinics supported", { baseline: undefined, unit: "" }), result: outcome2, target: 5, saved: undefined },
];

function hookValue(overrides = {}) {
  return {
    isAdmin: false,
    canEnter: true,
    frameworks: [{ id: "fw1", name: "Women's Rights 2026" }],
    selectedId: "fw1",
    setSelectedId: vi.fn(),
    data: {},
    fw: { id: "fw1", name: "Women's Rights 2026", periods: ["Q1", "Q2"] },
    ordered: [outcome1, outcome2],
    rows: defaultRows(),
    period: "Q1",
    setPeriod: vi.fn(),
    busy: false,
    error: "",
    reload: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/* run() mimics the real one closely enough: awaits the task and swallows its error into runErrors. */
function setup(overrides = {}) {
  const runErrors = [];
  const value = hookValue({
    run: async (fn) => {
      try {
        await fn();
      } catch (e) {
        runErrors.push(e.message);
      }
    },
    ...overrides,
  });
  useMEData.mockReturnValue(value);
  const user = userEvent.setup();
  const utils = render(<MEForms />);
  return { user, value, runErrors, ...utils };
}

const actualInput = (name) => screen.getByLabelText(`Actual for ${name}`);
const commentInput = (name) => screen.getByLabelText(`Comment for ${name}`);
const submitButton = () => screen.getByRole("button", { name: /^Submit/ });

beforeEach(() => {
  vi.clearAllMocks();
  api.mockResolvedValue({});
});

describe("MEForms: rendering", () => {
  it("shows the framework name and groups indicators under their result", () => {
    setup();
    expect(screen.getByText("Data collection form for Women's Rights 2026")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: outcome1.title })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: outcome2.title })).toBeInTheDocument();
    expect(screen.getByText("Girls enrolled")).toBeInTheDocument();
    expect(screen.getByText("Clinics supported")).toBeInTheDocument();
  });

  it("shows target, unit and baseline, and falls back to '-' when there is no baseline", () => {
    setup();
    expect(screen.getByText(/Target 100 % · Baseline 10/)).toBeInTheDocument();
    expect(screen.getByText(/Target 5 · Baseline -/)).toBeInTheDocument();
  });

  it("leaves out indicators that have no target for the period", () => {
    setup();
    expect(screen.queryByText("Indicator without target")).not.toBeInTheDocument();
  });

  it("pre-fills saved values and comments", () => {
    setup();
    expect(actualInput("Teachers trained")).toHaveValue(20);
    expect(commentInput("Teachers trained")).toHaveValue("On track");
    expect(actualInput("Girls enrolled")).toHaveValue(null);
  });

  it("does not render a group whose indicators all lack targets", () => {
    setup({ rows: defaultRows().map((r) => (r.result.id === "r2" ? { ...r, target: undefined } : r)) });
    expect(screen.queryByRole("region", { name: outcome2.title })).not.toBeInTheDocument();
  });

  it("shows an empty state when no indicator has a target", () => {
    setup({ rows: [] });
    expect(screen.getByText("No indicators have a target for Q1.")).toBeInTheDocument();
  });

  it("shows NoFramework and hides the form when there is no framework", () => {
    setup({ fw: undefined, rows: [] });
    expect(screen.getByTestId("no-framework")).toBeInTheDocument();
    expect(screen.queryByTestId("period-tabs")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Submit/ })).not.toBeInTheDocument();
    expect(screen.getByText("Enter results for a reporting period.")).toBeInTheDocument();
  });

  it("shows the error bar when the hook reports an error", () => {
    setup({ error: "Could not load framework" });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load framework");
  });
});

describe("MEForms: permissions and locking", () => {
  it("disables every input, hides submit and explains why when the person cannot enter values", () => {
    setup({ canEnter: false });
    expect(actualInput("Girls enrolled")).toBeDisabled();
    expect(commentInput("Girls enrolled")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Submit/ })).not.toBeInTheDocument();
    expect(screen.getByText(/only the administrator and the owning department/)).toBeInTheDocument();
  });

  it("locks approved rows but leaves the others editable", () => {
    setup();
    expect(actualInput("Schools reached")).toBeDisabled();
    expect(commentInput("Schools reached")).toBeDisabled();
    expect(actualInput("Teachers trained")).toBeEnabled();
  });

  it("disables inputs and submit while busy", () => {
    setup({ busy: true });
    expect(actualInput("Girls enrolled")).toBeDisabled();
    expect(submitButton()).toBeDisabled();
  });

  it("shows each row's status", () => {
    setup();
    const statuses = screen.getAllByTestId("status").map((el) => el.textContent);
    expect(statuses).toEqual(["none", "submitted", "approved", "none"]);
  });
});

describe("MEForms: submit button", () => {
  it("starts disabled with the plural label", () => {
    setup();
    expect(submitButton()).toBeDisabled();
    expect(submitButton()).toHaveTextContent("Submit values");
  });

  it("counts entered values and uses the singular for exactly one", async () => {
    const { user } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    expect(submitButton()).toBeEnabled();
    expect(submitButton()).toHaveTextContent("Submit 1 value");
    await user.type(actualInput("Clinics supported"), "4");
    expect(submitButton()).toHaveTextContent("Submit 2 values");
  });

  it("does not count a comment on its own", async () => {
    const { user } = setup();
    await user.type(commentInput("Girls enrolled"), "Waiting for data");
    expect(submitButton()).toBeDisabled();
  });

  it("counts a value of 0 as an entry", async () => {
    const { user } = setup();
    await user.type(actualInput("Girls enrolled"), "0");
    expect(submitButton()).toBeEnabled();
    expect(submitButton()).toHaveTextContent("Submit 1 value");
  });

  it("stops counting a value once it is cleared again", async () => {
    const { user } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    await user.clear(actualInput("Girls enrolled"));
    expect(submitButton()).toBeDisabled();
  });

  it("does not count rows that were not edited, even when they have saved values", async () => {
    const { user } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    expect(submitButton()).toHaveTextContent("Submit 1 value");
  });
});

describe("MEForms: submitting", () => {
  it("saves each entered value with its comment, in order, then reloads", async () => {
    const { user, value } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    await user.type(commentInput("Girls enrolled"), "Good term");
    await user.type(actualInput("Clinics supported"), "4");
    await user.click(submitButton());

    expect(api).toHaveBeenCalledTimes(2);
    expect(api).toHaveBeenNthCalledWith(1, "/me/frameworks/fw1/values", {
      method: "PUT",
      body: { indicatorId: "i1", period: "Q1", actual: "80", comment: "Good term" },
    });
    expect(api).toHaveBeenNthCalledWith(2, "/me/frameworks/fw1/values", {
      method: "PUT",
      body: { indicatorId: "i5", period: "Q1", actual: "4", comment: "" },
    });
    expect(value.reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the saved comment when only the actual value of an existing row is changed", async () => {
    const { user } = setup();
    const input = actualInput("Teachers trained");
    await user.clear(input);
    await user.type(input, "25");
    await user.click(submitButton());

    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith("/me/frameworks/fw1/values", {
      method: "PUT",
      body: { indicatorId: "i2", period: "Q1", actual: "25", comment: "On track" },
    });
  });

  it("sends a value of 0 instead of treating it as empty", async () => {
    const { user } = setup();
    await user.type(actualInput("Girls enrolled"), "0");
    await user.click(submitButton());
    expect(api).toHaveBeenCalledWith("/me/frameworks/fw1/values", {
      method: "PUT",
      body: { indicatorId: "i1", period: "Q1", actual: "0", comment: "" },
    });
  });

  it("never submits approved rows", async () => {
    const { user } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    await user.click(submitButton());
    const ids = api.mock.calls.map(([, opts]) => opts.body.indicatorId);
    expect(ids).not.toContain("i3");
  });

  it("clears the drafts after a successful submit", async () => {
    const { user } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    await user.click(submitButton());
    expect(actualInput("Girls enrolled")).toHaveValue(null);
    expect(submitButton()).toBeDisabled();
  });

  it("keeps the drafts and does not reload when a save fails", async () => {
    api.mockRejectedValueOnce(new Error("Network down"));
    const { user, value, runErrors } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    await user.click(submitButton());

    expect(runErrors).toEqual(["Network down"]);
    expect(value.reload).not.toHaveBeenCalled();
    expect(actualInput("Girls enrolled")).toHaveValue(80);
  });

  it("stops at the first failure so later values are not sent", async () => {
    api.mockRejectedValueOnce(new Error("Forbidden"));
    const { user } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    await user.type(actualInput("Clinics supported"), "4");
    await user.click(submitButton());
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("after a partial failure, clears what was saved, keeps the rest and reloads once", async () => {
    api.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Timeout"));
    const { user, value, runErrors } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    await user.type(actualInput("Clinics supported"), "4");
    await user.click(submitButton());

    expect(runErrors).toEqual(["Timeout"]);
    expect(value.reload).toHaveBeenCalledTimes(1);
    expect(actualInput("Girls enrolled")).toHaveValue(null);
    expect(actualInput("Clinics supported")).toHaveValue(4);
    expect(submitButton()).toHaveTextContent("Submit 1 value");
  });

  it("retries only the values that failed", async () => {
    api.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Timeout"));
    const { user } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    await user.type(actualInput("Clinics supported"), "4");
    await user.click(submitButton());
    api.mockClear();

    await user.click(submitButton());
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(
      "/me/frameworks/fw1/values",
      expect.objectContaining({ body: expect.objectContaining({ indicatorId: "i5", actual: "4" }) })
    );
  });
});

describe("MEForms: switching framework or period", () => {
  it("discards unsaved drafts when the period changes", async () => {
    const { user, rerender, value } = setup();
    await user.type(actualInput("Girls enrolled"), "80");
    expect(submitButton()).toHaveTextContent("Submit 1 value");

    useMEData.mockReturnValue({ ...value, period: "Q2" });
    rerender(<MEForms />);

    expect(actualInput("Girls enrolled")).toHaveValue(null);
    expect(submitButton()).toBeDisabled();
  });

  it("discards unsaved drafts when the framework changes", async () => {
    const { user, rerender, value } = setup();
    await user.type(actualInput("Girls enrolled"), "80");

    useMEData.mockReturnValue({ ...value, selectedId: "fw2" });
    rerender(<MEForms />);

    expect(actualInput("Girls enrolled")).toHaveValue(null);
  });

  it("uses the current period in the request", async () => {
    const { user } = setup({ period: "Q2" });
    await user.type(actualInput("Girls enrolled"), "80");
    await user.click(submitButton());
    expect(api).toHaveBeenCalledWith(
      "/me/frameworks/fw1/values",
      expect.objectContaining({ body: expect.objectContaining({ period: "Q2" }) })
    );
  });
});
