package com.auction;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("skeleton")
class AuctionApplicationTests {

    @LocalServerPort
    private int port;

    @Test
    void startsWithTheSelectedFrameworks() {
        assertThat(port).isPositive();
    }
}
