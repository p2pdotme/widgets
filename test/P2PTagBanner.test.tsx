import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { P2PTagBanner } from "../src/widgets/P2PTagBanner";

describe("P2PTagBanner (customer-facing)", () => {
  it("renders the friendly copy for a present tag", () => {
    render(<P2PTagBanner tag="awaiting_user" />);
    expect(screen.getByText(/awaiting your reply/i)).toBeInTheDocument();
  });

  it("renders 'Our team is reviewing' for reviewing and escalated", () => {
    const { rerender } = render(<P2PTagBanner tag="reviewing" />);
    expect(screen.getByText(/our team is reviewing/i)).toBeInTheDocument();
    rerender(<P2PTagBanner tag="escalated" />);
    expect(screen.getByText(/our team is reviewing/i)).toBeInTheDocument();
  });

  it("renders nothing when there is no tag and status is not resolved", () => {
    const { container } = render(<P2PTagBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a 'Chat closed by support' banner when status === 'resolved'", () => {
    render(<P2PTagBanner status="resolved" />);
    expect(screen.getByText(/chat closed by support/i)).toBeInTheDocument();
  });

  it("resolved status takes precedence over a present tag", () => {
    render(<P2PTagBanner tag="reviewing" status="resolved" />);
    expect(screen.getByText(/chat closed by support/i)).toBeInTheDocument();
    expect(screen.queryByText(/our team is reviewing/i)).not.toBeInTheDocument();
  });

  it("does not use internal protocol vocabulary in customer copy", () => {
    const { container } = render(<P2PTagBanner tag="escalated" />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/merchant|dispute|circle admin/i);
  });
});
