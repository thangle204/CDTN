import React from "react";
import { SearchResult } from "./SearchResult";
import "./SearchResultList.css";

export const SearchResultsList = ({ results }) => {
  return (
    <div className="results-list">
      {results.map((product) => (
        <SearchResult key={product.product_id} product={product} />
      ))}
    </div>
  );
};
