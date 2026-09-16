ALTER TABLE venue_list
    ADD COLUMN coordinate_basis text,
    ADD CONSTRAINT venue_coordinate_basis_valid CHECK (
        coordinate_basis IS NULL OR coordinate_basis IN ('building', 'entrance', 'center')
    ),
    ADD CONSTRAINT venue_coordinate_basis_requires_point CHECK (
        coordinate_basis IS NULL OR latitude IS NOT NULL
    ),
    ADD CONSTRAINT venue_location_scope CHECK (
        (venue_kind = 'physical')
        OR (
            venue_kind = 'undisclosed'
            AND address IS NULL
            AND latitude IS NULL
            AND longitude IS NULL
            AND coordinate_basis IS NULL
            AND timezone_id IS NULL
        )
        OR (
            venue_kind = 'online'
            AND locality_id IS NULL
            AND address IS NULL
            AND latitude IS NULL
            AND longitude IS NULL
            AND coordinate_basis IS NULL
            AND timezone_id IS NULL
        )
    );

COMMENT ON COLUMN venue_list.coordinate_basis IS
    'Meaning of the verified WGS84 point: building, entrance, or center.';

