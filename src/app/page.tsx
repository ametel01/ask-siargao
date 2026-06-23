import { LandingPage } from "@/features/landing/LandingPage";
import { fallbackWeatherSnapshot } from "@/server/public-pages/weather-snapshot";

export default function Home() {
  return <LandingPage weatherSnapshot={fallbackWeatherSnapshot} />;
}
