import { test, expect } from '@playwright/test';

// Deterministic function to prepare the page for visual regression testing
// It forces images to load eagerly, overrides GSAP hidden states, and waits for all images to decode.
async function preparePageForSnapshot(page) {
  // Scroll down organically to trigger native lazy loading and IntersectionObserver animations
  // Scroll organically element by element to ensure mobile Safari/WebKit triggers IntersectionObservers natively
  // Scroll organically using JS to ensure all browsers (including Mobile WebKit) trigger IntersectionObservers natively
  await page.evaluate(async () => {
    const scrollHeight = document.body.scrollHeight;
    for (let i = 0; i < scrollHeight; i += 300) {
      window.scrollTo(0, i);
      // Force a layout recalculation to ensure WebKit fires IntersectionObserver
      document.body.getBoundingClientRect();
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 100)));
    }
    window.scrollTo(0, 0);
  });
  
  // Wait for any remaining IntersectionObserver animations to finish
  await page.waitForTimeout(2000);

  // Wait natively for images to finish loading
  await page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll('img'));
    await Promise.all(images.map(img => {
      if (img.complete || !img.src) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));
  });

  // networkidle removed because external scripts can keep the network busy indefinitely.
  await page.waitForTimeout(1500);
}

test.describe('Visual Regression Tests', () => {
  test('homepage visual comparison', async ({ page }) => {
    await page.goto('/');
    await preparePageForSnapshot(page);

    await expect(page).toHaveScreenshot('homepage-full.png', { 
      fullPage: true, 
      maxDiffPixelRatio: 0.08,
      timeout: 15000
    });
  });

  test('hero section visual comparison', async ({ page }) => {
    await page.goto('/');
    await preparePageForSnapshot(page);

    const hero = page.locator('#inicio');
    await expect(hero).toHaveScreenshot('hero-section.png', {
      maxDiffPixelRatio: 0.08,
      timeout: 15000
    });
  });
});
