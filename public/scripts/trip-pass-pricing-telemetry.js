if (navigator.doNotTrack !== "1") {
  const section = document.getElementById("trip-pass");

  if (section) {
    let sent = false;
    const send = () => {
      if (sent) {
        return;
      }

      sent = true;
      fetch("/api/observability/events", {
        body: JSON.stringify({
          name: "trip_pass_pricing_viewed",
          surface: "landing",
        }),
        headers: { "content-type": "application/json" },
        keepalive: true,
        method: "POST",
      }).catch(() => undefined);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          send();
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(section);
  }
}
