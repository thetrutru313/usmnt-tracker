import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnnouncementSection } from "@/pages/Admin";

function setup() {
  const fetchMock = vi.fn();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/admin/announcements/audience")) {
      return new Response(JSON.stringify({ devices: 3 }), { status: 200 });
    }
    if (url.endsWith("/api/admin/announcements") && init?.method === "POST") {
      return new Response(JSON.stringify({ devices: 3, sent: 3 }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnnouncementSection token="admin-token" onUnauthorized={() => {}} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Admin — Send announcement", () => {
  it("1: can't send until there's a message", async () => {
    setup();
    const button = await screen.findByRole("button", { name: "Send to 3 devices" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/roster for the November camp/i), { target: { value: "Roster is out" } });
    expect(button).toBeEnabled();
  });

  it("2: asks to confirm, then posts the announcement and reports delivery", async () => {
    const fetchMock = setup();
    fireEvent.change(await screen.findByPlaceholderText(/roster for the November camp/i), { target: { value: "Roster is out" } });
    fireEvent.change(screen.getByPlaceholderText("/schedule"), { target: { value: "/schedule" } });
    fireEvent.click(await screen.findByRole("button", { name: "Send to 3 devices" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, send" }));

    expect(await screen.findByText("Sent to 3 of 3 devices.")).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/admin/announcements") && (init as RequestInit)?.method === "POST");
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({ title: "USMNT", body: "Roster is out", url: "/schedule" });
    await waitFor(() => expect((post![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer admin-token" }));
  });
});
