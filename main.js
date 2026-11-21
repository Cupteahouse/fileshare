const thanhDieuHuong = document.querySelector('.header__navform');
const nutMenu = document.querySelector('.hamburger');
const cacLinkWeb = document.querySelectorAll('a[data-category]');
const cacLinkWebHinh = document.querySelectorAll('#danh-muc article img');
const nutKhamPham = document.querySelector('.kham-pha');
const oSoLuongGio = document.querySelector('#cartCount');
const dsBestSeller = document.querySelectorAll('#san-pham article');

//Hàm bật tắt hamberger ở màn hình điện thoại
function batTatMenuDienThoai() {
    thanhDieuHuong.classList.toggle('active--ham');
    nutMenu.classList.toggle('active');
}

//Hàm cập nhật số lượng hàng ở gốc trên bên phải
function capNhatSoGioHang() {
    const gioHang = JSON.parse(localStorage.getItem('cart')) || [];
    let tongSoLuong = 0;

    gioHang.forEach(function (monHang) {
        tongSoLuong += monHang.sl;
    });

    if (oSoLuongGio) {
        oSoLuongGio.textContent = tongSoLuong;
    }
}

//hàm kiểm tra xem đã đăng nhập hay chưa nếu đã đăng nhập thì "Xin chào," + tên tài khoản
//nếu chưa đặng nhập thì hiện nút đăng nhập và đăng ký
function checkAuthentication() {
    const authBox = document.querySelector('#authentication');
    const userInfoBox = document.querySelector('#user-info');
    const principal = document.querySelector('#principal');
    const logoutBtn = document.querySelector('#logout');

    const currentUser = JSON.parse(localStorage.getItem('currentUser'));

    if (authBox && userInfoBox && principal) {
        if (currentUser != null) {
            authBox.classList.add('hidden');
            userInfoBox.classList.remove('hidden');
            principal.textContent = 'Xin chào, ' + currentUser.username;
        } else {
            authBox.classList.remove('hidden');
            userInfoBox.classList.add('hidden');
        }
    }
    //hàm sử lý khi bấm nút đăng xuất xóa thông tin trong currentUser(tai khoản hiện tại) và giỏ hàng
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            localStorage.removeItem('currentUser');
            localStorage.removeItem('cart');
            alert('Đã đăng xuất!');
            location.href = 'index.html';
        });
    }
}

//hàm xử lý khi bấm vào nút khám phá hiện thị tất cả sản phầm ở shop.html
if (nutKhamPham) {
    nutKhamPham.addEventListener('click', function () {
        localStorage.setItem('selectedCategory', '');
        window.location.href = 'shop.html';
    });
}

//xử lý khi bấm BestSeller hiện thị chi tiết sản phầm
dsBestSeller.forEach((i) => {
    i.addEventListener('click', function () {
        const data = {
            id: i.getAttribute('data-id'),
            category: i.getAttribute('data-category'),
            name: i.querySelector('figcaption').textContent.trim(),
            price: Number(i.getAttribute('data-price')),
            image: i.querySelector('img').getAttribute('src')
        };
        localStorage.setItem('selectedProduct', JSON.stringify(data));
        window.location.href = 'detail.html';
    })
})

// xử lý khi bấm các hình ở index.html
cacLinkWebHinh.forEach((e) => {
    e.addEventListener('click', function () {
        const loai = e.getAttribute('data-category');
        localStorage.setItem('selectedCategory', loai);
        window.location.href = 'shop.html';
    });
});

cacLinkWeb.forEach((e) => {
    e.addEventListener('click', function (evt) {
        evt.preventDefault();
        const loai = e.getAttribute('data-category');
        localStorage.setItem('selectedCategory', loai);
        window.location.href = 'shop.html';
    });
});


//chạy hàm 1 lần khi mở web
checkAuthentication();
capNhatSoGioHang();
if (nutMenu) {
    nutMenu.addEventListener('click', batTatMenuDienThoai);
}