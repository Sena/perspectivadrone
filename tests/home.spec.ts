import { test, expect } from '@playwright/test';

test.describe('E2E Interactions', () => {

  test('Lightbox opens and closes on portfolio image click', async ({ page }) => {
    await page.goto('/');

    // Wait for the portfolio grid to load
    const portfolioGrid = page.locator('#portfolio');
    await expect(portfolioGrid).toBeVisible();

    // Click the first portfolio image
    const firstPortfolioImage = page.locator('#portfolio .group').first();
    await firstPortfolioImage.click();

    // Check if the lightbox container becomes visible
    const lightbox = page.locator('#portfolio-lightbox');
    await expect(lightbox).toBeVisible();

    // Click the close button
    const closeBtn = page.locator('#lightbox-close');
    await closeBtn.click();

    // Ensure it's hidden again
    await expect(lightbox).toBeHidden();
  });

  test('Lightbox keyboard navigation works correctly', async ({ page }) => {
    await page.goto('/');

    const firstPortfolioImage = page.locator('#portfolio .group').first();
    await firstPortfolioImage.scrollIntoViewIfNeeded();
    await firstPortfolioImage.click();

    const lightbox = page.locator('#portfolio-lightbox');
    await expect(lightbox).toBeVisible();

    const lightboxImg = page.locator('#lightbox-img');
    const firstImgSrc = await lightboxImg.getAttribute('src');

    // Press ArrowRight to go to next image
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const secondImgSrc = await lightboxImg.getAttribute('src');
    expect(secondImgSrc).not.toEqual(firstImgSrc);

    // Press ArrowLeft to go back
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    const backToFirstSrc = await lightboxImg.getAttribute('src');
    expect(backToFirstSrc).toEqual(firstImgSrc);

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(lightbox).toBeHidden();
  });

  test('Lightbox swipe navigation works on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const firstPortfolioImage = page.locator('#portfolio .group').first();
    await firstPortfolioImage.scrollIntoViewIfNeeded();
    await firstPortfolioImage.click();

    const lightbox = page.locator('#portfolio-lightbox');
    await expect(lightbox).toBeVisible();

    const lightboxImg = page.locator('#lightbox-img');
    const firstImgSrc = await lightboxImg.getAttribute('src');

    // Helper to simulate swipe via evaluate
    const simulateSwipe = async (startX: number, endX: number) => {
      await lightbox.evaluate((el, args) => {
        try {
          const touchStart = new Touch({ identifier: 1, target: el, screenX: args.startX, screenY: args.y, clientX: args.startX, clientY: args.y });
          el.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [touchStart] }));
          
          const touchEnd = new Touch({ identifier: 1, target: el, screenX: args.endX, screenY: args.y, clientX: args.endX, clientY: args.y });
          el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touchEnd] }));
        } catch (e) {
          // Firefox fallback for TouchEvent
          const startEvent = new Event('touchstart') as any;
          startEvent.changedTouches = [{ screenX: args.startX }];
          el.dispatchEvent(startEvent);
          
          const endEvent = new Event('touchend') as any;
          endEvent.changedTouches = [{ screenX: args.endX }];
          el.dispatchEvent(endEvent);
        }
      }, { startX, endX, y: box!.y + box!.height / 2 });
    };

    // Simulate swipe left (next)
    const box = await lightbox.boundingBox();
    if (box) {
      await simulateSwipe(box.x + box.width * 0.8, box.x + box.width * 0.2);
    }
    
    await page.waitForTimeout(200);
    const secondImgSrc = await lightboxImg.getAttribute('src');
    expect(secondImgSrc).not.toEqual(firstImgSrc);

    // Simulate swipe right (prev)
    if (box) {
      await simulateSwipe(box.x + box.width * 0.2, box.x + box.width * 0.8);
    }

    await page.waitForTimeout(200);
    const backToFirstSrc = await lightboxImg.getAttribute('src');
    expect(backToFirstSrc).toEqual(firstImgSrc);
  });

  test('Contact form HTML5 validation prevents empty submission', async ({ page }) => {
    await page.goto('/');
    
    // Find the submit button
    const submitBtn = page.locator('#contato button[type="submit"]');
    
    // Click submit without filling required fields
    await submitBtn.click();
    
    // Wait a brief moment to ensure default behavior triggers
    await page.waitForTimeout(500);

    // Using evaluate to check if form is valid according to the browser API
    const isFormValid = await page.evaluate(() => {
      const form = document.querySelector('#contato form') as HTMLFormElement;
      return form ? form.checkValidity() : true;
    });

    // The form should NOT be valid because required fields are empty
    expect(isFormValid).toBe(false);
  });

  test('Contact form full submission flow with mocked API', async ({ page }) => {
    // Intercept API call to prevent real emails and simulate network delay
    await page.route('/api/contact', async route => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
    });

    await page.goto('/');

    // Fill out the form
    await page.locator('#contact-form input[name="name"]').fill('Automated Tester');
    await page.locator('#contact-form input[name="email"]').fill('test@example.com');
    await page.locator('#contact-form textarea[name="message"]').fill('Hello, this is a test message from Playwright.');

    const submitBtn = page.locator('#contact-form button[type="submit"]');
    
    // Click submit and check immediate loading state
    await submitBtn.click();
    await expect(submitBtn).toHaveText('Enviando...');

    // Form should hide and success message should appear after network response
    const form = page.locator('#contact-form');
    const successMsg = page.locator('#success-msg');

    await expect(successMsg).toBeVisible();
    await expect(form).toBeHidden();
  });

  test('Mobile hamburger menu toggles correctly', async ({ page }) => {
    // Emulate a mobile device explicitly for this test
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const mobileMenuBtn = page.locator('nav button.md\\:hidden');
    const mobileMenu = page.locator('#mobile-menu');

    // Initially menu should be hidden
    // Note: Tailwind v4 hidden class might just use display: none, 
    // but the ID or class might vary. We'll check visibility.
    // In Base.astro or Navbar.astro, it's typically hidden by default.
    await expect(mobileMenuBtn).toBeVisible();

    // Click to open
    await mobileMenuBtn.click();

    // Wait for JS animation if any, check if a menu link becomes visible
    const firstMenuLink = mobileMenu.locator('a').first();
    await expect(firstMenuLink).toBeVisible();
  });

  test('SEO and Accessibility essentials are present', async ({ page }) => {
    await page.goto('/');

    // Check <title>
    await expect(page).toHaveTitle(/Perspectiva/i);

    // Check meta description
    const metaDesc = page.locator('meta[name="description"]');
    await expect(metaDesc).toHaveAttribute('content', /.+/); // Not empty

    // Check all images have an alt attribute
    const images = await page.locator('img').all();
    for (const img of images) {
      const alt = await img.getAttribute('alt');
      // EmDash sometimes uses empty alt for decorative, but the attribute must exist
      expect(alt).not.toBeNull();
    }
  });

  test('Navbar smooth scroll and Scroll Spy active state work correctly', async ({ page }) => {
    // Use desktop viewport to ensure desktop menu is visible
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    const homeLink = page.locator('#desktop-menu a').filter({ hasText: 'Início' }).first();
    const portfolioLink = page.locator('#desktop-menu a').filter({ hasText: 'Portfólio' }).first();
    
    // Check initial active state
    await expect(homeLink).toHaveClass(/(^|\s)text-amber-400(\s|$)/);
    await expect(portfolioLink).toHaveClass(/(^|\s)text-white\/70(\s|$)/);

    // Click "Portfólio"
    await portfolioLink.click();
    
    // Wait for smooth scroll animation (1000ms is used in Navbar.astro timeout)
    await page.waitForTimeout(1200);

    // The active class should move to "Portfólio"
    await expect(portfolioLink).toHaveClass(/(^|\s)text-amber-400(\s|$)/);
    await expect(homeLink).toHaveClass(/(^|\s)text-white\/70(\s|$)/);

    // Check if #portfolio section is actually in the viewport now
    const portfolioSection = page.locator('#portfolio');
    await expect(portfolioSection).toBeInViewport();
  });

});
