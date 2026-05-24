export interface PortfolioRawEntry {
  data: {
    image?: any;
    title?: string;
    location?: string;
    coordinates?: string;
    display_order?: number;
    layout_type?: string;
  };
  edit?: Record<string, any>;
}

export interface PortfolioItem {
  img: any;
  title: string | undefined;
  location: string | undefined;
  coords: string | undefined;
  category: string;
  display_order: number;
  layout_type: string;
  edit: Record<string, any> | undefined;
}

export function formatAndSortPortfolio(items: PortfolioRawEntry[]): PortfolioItem[] {
  if (!items || !Array.isArray(items)) return [];

  return items
    .map((entry) => ({
      img: entry.data.image,
      title: entry.data.title,
      location: entry.data.location,
      coords: entry.data.coordinates,
      category: "Trabalho",
      display_order: Number(entry.data.display_order) || 0,
      layout_type: entry.data.layout_type || "standard",
      edit: entry.edit,
    }))
    .sort((a, b) => a.display_order - b.display_order);
}
